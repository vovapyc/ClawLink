from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

import httpx
from realtime import RealtimeSubscribeStates
from supabase import acreate_client


LOGGER = logging.getLogger("clawlink-openclaw-bridge")

ENV_PREFIX = "CLAWLINK_"
DEFAULT_GATEWAY_URL = "http://127.0.0.1:18789"
DEFAULT_OPENCLAW_HOOK_PATH = "/hooks/agent"
DEFAULT_OPENCLAW_NAME = "ClawLink"

DEFAULT_PROMPT_TEMPLATE = """ClawLink delivered a verified inbound turn.

Bridge checks already passed:
- the sender is the other agent
- the turn_index is new
- it is now your turn

Room metadata:
- room_id: {room_id}
- room_channel_id: {room_channel_id}
- message_id: {message_id}
- turn_index: {turn_index}
- sender: {sender}
- sender_name: {sender_name}

Message body:
{content}

Raw payload:
{message_json}
"""


@dataclass(frozen=True)
class BridgeConfig:
    supabase_url: str
    supabase_anon_key: str
    room_channel_id: str
    local_agent_label: str
    openclaw_agent_hook_url: str
    openclaw_hook_token: str
    openclaw_name: str
    openclaw_agent_id: Optional[str]
    openclaw_model: Optional[str]
    openclaw_thinking: Optional[str]
    openclaw_timeout_seconds: Optional[int]
    prompt_template_path: Optional[Path]
    state_file: Path
    pid_file: Path
    log_file: Path
    log_level: str


@dataclass(frozen=True)
class RuntimePaths:
    state_file: Path
    pid_file: Path
    log_file: Path


@dataclass(frozen=True)
class MessageEvent:
    message_id: str
    room_id: str
    room_channel_id: str
    sender: str
    sender_name: str
    content: str
    turn_index: int
    created_at: Optional[str]
    raw_payload: Dict[str, Any]


def env_name(suffix: str) -> str:
    return f"{ENV_PREFIX}{suffix}"


def default_runtime_dir() -> Path:
    state_home = os.environ.get("XDG_STATE_HOME")
    if state_home:
        return Path(state_home).expanduser() / "clawlink-openclaw-bridge"
    return Path.home() / ".local" / "state" / "clawlink-openclaw-bridge"


def sanitize_fragment(value: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in value)
    cleaned = cleaned.strip("-")
    return cleaned or "room"


def default_pid_file(room_channel_id: str, local_agent_label: str) -> Path:
    slug = sanitize_fragment(f"{room_channel_id}-{local_agent_label}")
    return default_runtime_dir() / f"{slug}.pid"


def default_log_file(room_channel_id: str, local_agent_label: str) -> Path:
    slug = sanitize_fragment(f"{room_channel_id}-{local_agent_label}")
    return default_runtime_dir() / f"{slug}.log"


def default_state_file(room_channel_id: str, local_agent_label: str) -> Path:
    slug = sanitize_fragment(f"{room_channel_id}-{local_agent_label}")
    return default_runtime_dir() / f"{slug}.state.json"


def ensure_parent_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def atomic_write_json(path: Path, payload: Dict[str, Any]) -> None:
    ensure_parent_dir(path)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(path)


def load_json(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        LOGGER.warning("Ignoring invalid JSON state file at %s", path)
        return {}


def next_expected_sender(turn_index: int) -> str:
    return "agent_a" if turn_index % 2 == 0 else "agent_b"


def is_pid_running(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


class BridgeStateStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.payload = load_json(path)

    def last_turn_index(self) -> int:
        value = self.payload.get("last_turn_index")
        return int(value) if isinstance(value, int) else 0

    def last_message_id(self) -> Optional[str]:
        value = self.payload.get("last_message_id")
        return value if isinstance(value, str) else None

    def update(self, event: MessageEvent) -> None:
        self.payload = {
            "room_channel_id": event.room_channel_id,
            "room_id": event.room_id,
            "last_turn_index": event.turn_index,
            "last_message_id": event.message_id,
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        atomic_write_json(self.path, self.payload)


class PidFile:
    def __init__(self, path: Path) -> None:
        self.path = path

    def write(self) -> None:
        ensure_parent_dir(self.path)
        self.path.write_text(str(os.getpid()), encoding="utf-8")

    def remove(self) -> None:
        try:
            self.path.unlink()
        except FileNotFoundError:
            return


class BridgeApp:
    def __init__(self, config: BridgeConfig) -> None:
        self.config = config
        self.stop_event = asyncio.Event()
        self.state_lock = asyncio.Lock()
        self.state_store = BridgeStateStore(config.state_file)
        self.inflight_message_ids: set[str] = set()
        self.prompt_template = self._load_prompt_template()
        self.pid_file = PidFile(config.pid_file)

    def _load_prompt_template(self) -> str:
        if self.config.prompt_template_path is None:
            return DEFAULT_PROMPT_TEMPLATE
        return self.config.prompt_template_path.read_text(encoding="utf-8")

    async def run(self) -> int:
        self.pid_file.write()
        self._install_signal_handlers()
        try:
            await self._watch_forever()
        finally:
            self.pid_file.remove()
        return 0

    def _install_signal_handlers(self) -> None:
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, self.stop_event.set)
            except NotImplementedError:
                signal.signal(sig, lambda *_args: self.stop_event.set())

    async def _watch_forever(self) -> None:
        LOGGER.info(
            "Watching Supabase channel %s as %s",
            self.config.room_channel_id,
            self.config.local_agent_label,
        )
        client = await acreate_client(
            self.config.supabase_url,
            self.config.supabase_anon_key,
        )
        channel = client.channel(self.config.room_channel_id)
        subscribed_future: asyncio.Future[None] = asyncio.get_running_loop().create_future()

        def on_subscribe(state: RealtimeSubscribeStates, error: Optional[Exception]) -> None:
            if state == RealtimeSubscribeStates.SUBSCRIBED:
                LOGGER.info("Subscribed to Supabase Realtime channel %s", self.config.room_channel_id)
                if not subscribed_future.done():
                    subscribed_future.set_result(None)
                return
            if subscribed_future.done():
                if error is not None:
                    LOGGER.error("Subscription state %s: %s", state.value, error)
                else:
                    LOGGER.warning("Subscription state changed: %s", state.value)
                return

            if error is not None:
                subscribed_future.set_exception(
                    RuntimeError(f"Supabase subscribe failed with {state.value}: {error}")
                )
                return
            subscribed_future.set_exception(
                RuntimeError(f"Supabase subscribe failed with state {state.value}")
            )

        def on_broadcast(payload: Dict[str, Any]) -> None:
            asyncio.create_task(self._handle_broadcast(payload))

        channel.on_broadcast("message", on_broadcast)
        await channel.subscribe(on_subscribe)
        await subscribed_future

        try:
            await self.stop_event.wait()
        finally:
            await channel.unsubscribe()
            await client.remove_channel(channel)

    async def _handle_broadcast(self, envelope: Dict[str, Any]) -> None:
        event = self._parse_message_event(envelope)
        if event is None:
            return

        should_dispatch = await self._should_dispatch(event)
        if not should_dispatch:
            return

        try:
            await self._dispatch_to_openclaw(event)
        except Exception:
            LOGGER.exception(
                "Failed to forward turn %s (%s) to OpenClaw",
                event.turn_index,
                event.message_id,
            )
        else:
            async with self.state_lock:
                self.state_store.update(event)
                self.inflight_message_ids.discard(event.message_id)
            LOGGER.info(
                "Forwarded turn %s from %s to OpenClaw",
                event.turn_index,
                event.sender,
            )

    def _parse_message_event(self, envelope: Dict[str, Any]) -> Optional[MessageEvent]:
        payload = envelope.get("payload")
        if not isinstance(payload, dict):
            LOGGER.debug("Ignoring malformed broadcast envelope: %r", envelope)
            return None

        required = {"id", "room_id", "sender", "content", "turn_index"}
        missing = [key for key in required if key not in payload]
        if missing:
            LOGGER.debug("Ignoring payload missing required fields %s: %r", missing, payload)
            return None

        try:
            turn_index = int(payload["turn_index"])
        except (TypeError, ValueError):
            LOGGER.debug("Ignoring payload with invalid turn_index: %r", payload)
            return None

        sender = str(payload["sender"])
        if sender not in {"agent_a", "agent_b"}:
            LOGGER.debug("Ignoring payload with invalid sender: %r", payload)
            return None

        room_channel_id = str(payload.get("room_channel_id") or self.config.room_channel_id)

        return MessageEvent(
            message_id=str(payload["id"]),
            room_id=str(payload["room_id"]),
            room_channel_id=room_channel_id,
            sender=sender,
            sender_name=str(payload.get("sender_name") or ""),
            content=str(payload["content"]),
            turn_index=turn_index,
            created_at=str(payload["created_at"]) if payload.get("created_at") else None,
            raw_payload=payload,
        )

    async def _should_dispatch(self, event: MessageEvent) -> bool:
        async with self.state_lock:
            if event.sender == self.config.local_agent_label:
                LOGGER.debug(
                    "Ignoring turn %s because sender %s is local",
                    event.turn_index,
                    event.sender,
                )
                return False

            if event.turn_index <= self.state_store.last_turn_index():
                LOGGER.debug(
                    "Ignoring turn %s because last seen turn is %s",
                    event.turn_index,
                    self.state_store.last_turn_index(),
                )
                return False

            if event.message_id == self.state_store.last_message_id():
                LOGGER.debug(
                    "Ignoring message %s because it already matched persisted state",
                    event.message_id,
                )
                return False

            if next_expected_sender(event.turn_index) != self.config.local_agent_label:
                LOGGER.debug(
                    "Ignoring turn %s because the next sender should not be %s",
                    event.turn_index,
                    self.config.local_agent_label,
                )
                return False

            if event.message_id in self.inflight_message_ids:
                LOGGER.debug("Ignoring message %s because it is already inflight", event.message_id)
                return False

            self.inflight_message_ids.add(event.message_id)
            return True

    async def _dispatch_to_openclaw(self, event: MessageEvent) -> None:
        message = self._render_prompt(event)
        payload: Dict[str, Any] = {
            "message": message,
            "name": self.config.openclaw_name,
            "wakeMode": "now",
            "deliver": False,
        }
        if self.config.openclaw_agent_id:
            payload["agentId"] = self.config.openclaw_agent_id
        if self.config.openclaw_model:
            payload["model"] = self.config.openclaw_model
        if self.config.openclaw_thinking:
            payload["thinking"] = self.config.openclaw_thinking
        if self.config.openclaw_timeout_seconds is not None:
            payload["timeoutSeconds"] = self.config.openclaw_timeout_seconds

        headers = {
            "Authorization": f"Bearer {self.config.openclaw_hook_token}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                self.config.openclaw_agent_hook_url,
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            LOGGER.debug("OpenClaw response: %s", response.text)

    def _render_prompt(self, event: MessageEvent) -> str:
        template_data = {
            "message_id": event.message_id,
            "room_id": event.room_id,
            "room_channel_id": event.room_channel_id,
            "sender": event.sender,
            "sender_name": event.sender_name,
            "content": event.content,
            "body": event.content,
            "turn_index": event.turn_index,
            "created_at": event.created_at or "",
            "message_json": json.dumps(event.raw_payload, ensure_ascii=False, indent=2, sort_keys=True),
        }
        return self.prompt_template.format(**template_data)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="clawlink-openclaw-bridge",
        description="Subscribe to a ClawLink Supabase Realtime room and wake a local OpenClaw gateway.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "--supabase-url",
        default=os.environ.get(env_name("SUPABASE_URL")),
        help=f"Supabase project URL. Env: {env_name('SUPABASE_URL')}",
    )
    common.add_argument(
        "--supabase-anon-key",
        default=os.environ.get(env_name("SUPABASE_ANON_KEY")),
        help=f"Supabase anon key. Env: {env_name('SUPABASE_ANON_KEY')}",
    )
    common.add_argument(
        "--room-channel-id",
        default=os.environ.get(env_name("ROOM_CHANNEL_ID")),
        help=f"ClawLink room_channel_id. Env: {env_name('ROOM_CHANNEL_ID')}",
    )
    common.add_argument(
        "--local-agent-label",
        choices=["agent_a", "agent_b"],
        default=os.environ.get(env_name("LOCAL_AGENT_LABEL")),
        help=f"Which side this bridge represents. Env: {env_name('LOCAL_AGENT_LABEL')}",
    )
    common.add_argument(
        "--openclaw-gateway-url",
        default=os.environ.get(env_name("OPENCLAW_GATEWAY_URL"), DEFAULT_GATEWAY_URL),
        help=f"Base URL for the local OpenClaw gateway. Env: {env_name('OPENCLAW_GATEWAY_URL')}",
    )
    common.add_argument(
        "--openclaw-hook-path",
        default=os.environ.get(env_name("OPENCLAW_HOOK_PATH"), DEFAULT_OPENCLAW_HOOK_PATH),
        help=f"OpenClaw hook path for agent ingress. Env: {env_name('OPENCLAW_HOOK_PATH')}",
    )
    common.add_argument(
        "--openclaw-hook-token",
        default=os.environ.get(env_name("OPENCLAW_HOOK_TOKEN")),
        help=f"Shared secret for the local OpenClaw hook endpoint. Env: {env_name('OPENCLAW_HOOK_TOKEN')}",
    )
    common.add_argument(
        "--openclaw-name",
        default=os.environ.get(env_name("OPENCLAW_NAME"), DEFAULT_OPENCLAW_NAME),
        help=f"Optional hook run name shown inside OpenClaw. Env: {env_name('OPENCLAW_NAME')}",
    )
    common.add_argument(
        "--openclaw-agent-id",
        default=os.environ.get(env_name("OPENCLAW_AGENT_ID")),
        help=f"Optional OpenClaw agent id. Env: {env_name('OPENCLAW_AGENT_ID')}",
    )
    common.add_argument(
        "--openclaw-model",
        default=os.environ.get(env_name("OPENCLAW_MODEL")),
        help=f"Optional OpenClaw model override. Env: {env_name('OPENCLAW_MODEL')}",
    )
    common.add_argument(
        "--openclaw-thinking",
        default=os.environ.get(env_name("OPENCLAW_THINKING")),
        help=f"Optional OpenClaw thinking override. Env: {env_name('OPENCLAW_THINKING')}",
    )
    common.add_argument(
        "--openclaw-timeout-seconds",
        type=int,
        default=_int_env(env_name("OPENCLAW_TIMEOUT_SECONDS")),
        help=f"Optional OpenClaw hook timeoutSeconds payload. Env: {env_name('OPENCLAW_TIMEOUT_SECONDS')}",
    )
    common.add_argument(
        "--prompt-template",
        type=Path,
        default=Path(os.environ[env_name("PROMPT_TEMPLATE")]).expanduser()
        if os.environ.get(env_name("PROMPT_TEMPLATE"))
        else None,
        help=f"Optional prompt template file. Env: {env_name('PROMPT_TEMPLATE')}",
    )
    common.add_argument(
        "--state-file",
        type=Path,
        help=f"Persisted dedupe state file. Env: {env_name('STATE_FILE')}",
    )
    common.add_argument(
        "--pid-file",
        type=Path,
        help=f"PID file for background process management. Env: {env_name('PID_FILE')}",
    )
    common.add_argument(
        "--log-file",
        type=Path,
        help=f"Log file for background process management. Env: {env_name('LOG_FILE')}",
    )
    common.add_argument(
        "--log-level",
        default=os.environ.get(env_name("LOG_LEVEL"), "INFO"),
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        help=f"Logging verbosity. Env: {env_name('LOG_LEVEL')}",
    )

    watch = subparsers.add_parser(
        "watch",
        parents=[common],
        help="Run the bridge in the foreground and stream events.",
    )
    watch.set_defaults(handler=handle_watch)

    start = subparsers.add_parser(
        "start",
        parents=[common],
        help="Start the bridge in the background and return immediately.",
    )
    start.set_defaults(handler=handle_start)

    stop = subparsers.add_parser(
        "stop",
        parents=[common],
        help="Stop the background bridge process using its PID file.",
    )
    stop.set_defaults(handler=handle_stop)

    status = subparsers.add_parser(
        "status",
        parents=[common],
        help="Show whether the background bridge process is running.",
    )
    status.set_defaults(handler=handle_status)

    return parser


def _int_env(name: str) -> Optional[int]:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except ValueError as exc:
        raise SystemExit(f"Invalid integer value in {name}: {raw}") from exc


def resolve_config(args: argparse.Namespace) -> BridgeConfig:
    room_channel_id = require_value(args.room_channel_id, "--room-channel-id")
    local_agent_label = require_value(args.local_agent_label, "--local-agent-label")

    runtime_paths = resolve_runtime_paths(args)

    hook_url = args.openclaw_gateway_url.rstrip("/") + "/" + args.openclaw_hook_path.lstrip("/")

    return BridgeConfig(
        supabase_url=require_value(args.supabase_url, "--supabase-url"),
        supabase_anon_key=require_value(args.supabase_anon_key, "--supabase-anon-key"),
        room_channel_id=room_channel_id,
        local_agent_label=local_agent_label,
        openclaw_agent_hook_url=hook_url,
        openclaw_hook_token=require_value(args.openclaw_hook_token, "--openclaw-hook-token"),
        openclaw_name=args.openclaw_name,
        openclaw_agent_id=args.openclaw_agent_id,
        openclaw_model=args.openclaw_model,
        openclaw_thinking=args.openclaw_thinking,
        openclaw_timeout_seconds=args.openclaw_timeout_seconds,
        prompt_template_path=args.prompt_template.expanduser() if args.prompt_template else None,
        state_file=runtime_paths.state_file,
        pid_file=runtime_paths.pid_file,
        log_file=runtime_paths.log_file,
        log_level=args.log_level,
    )


def resolve_runtime_paths(args: argparse.Namespace) -> RuntimePaths:
    room_channel_id = require_value(args.room_channel_id, "--room-channel-id")
    local_agent_label = require_value(args.local_agent_label, "--local-agent-label")
    return RuntimePaths(
        state_file=resolve_path(
            args.state_file,
            os.environ.get(env_name("STATE_FILE")),
            default_state_file(room_channel_id, local_agent_label),
        ),
        pid_file=resolve_path(
            args.pid_file,
            os.environ.get(env_name("PID_FILE")),
            default_pid_file(room_channel_id, local_agent_label),
        ),
        log_file=resolve_path(
            args.log_file,
            os.environ.get(env_name("LOG_FILE")),
            default_log_file(room_channel_id, local_agent_label),
        ),
    )


def resolve_path(cli_value: Optional[Path], env_value: Optional[str], default: Path) -> Path:
    if cli_value is not None:
        return cli_value.expanduser()
    if env_value:
        return Path(env_value).expanduser()
    return default


def require_value(value: Optional[str], flag_name: str) -> str:
    if value is None or value == "":
        raise SystemExit(f"Missing required value for {flag_name}")
    return value


def configure_logging(level: str, log_file: Optional[Path] = None) -> None:
    handlers: list[logging.Handler]
    if log_file is None:
        handlers = [logging.StreamHandler()]
    else:
        ensure_parent_dir(log_file)
        handlers = [logging.FileHandler(log_file, encoding="utf-8")]

    logging.basicConfig(
        level=getattr(logging, level.upper()),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=handlers,
        force=True,
    )


def handle_watch(args: argparse.Namespace) -> int:
    config = resolve_config(args)
    configure_logging(config.log_level)
    app = BridgeApp(config)
    return asyncio.run(app.run())


def handle_start(args: argparse.Namespace) -> int:
    config = resolve_config(args)
    configure_logging(config.log_level)

    existing_pid = read_pid(config.pid_file)
    if existing_pid is not None and is_pid_running(existing_pid):
        print(f"Bridge already running with pid {existing_pid}")
        return 0
    if existing_pid is not None:
        config.pid_file.unlink(missing_ok=True)

    ensure_parent_dir(config.log_file)
    log_handle = open(config.log_file, "a", encoding="utf-8")
    child_argv = build_watch_command(config)
    child_env = build_watch_env(config)
    proc = subprocess.Popen(
        child_argv,
        env=child_env,
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
    )
    time.sleep(0.5)
    if proc.poll() is not None:
        print(f"Bridge failed to start. Check log file: {config.log_file}")
        return 1

    print(f"Bridge started in background (pid {proc.pid})")
    print(f"PID file: {config.pid_file}")
    print(f"Log file: {config.log_file}")
    return 0


def handle_stop(args: argparse.Namespace) -> int:
    runtime_paths = resolve_runtime_paths(args)
    pid = read_pid(runtime_paths.pid_file)
    if pid is None:
        print(f"No PID file found at {runtime_paths.pid_file}")
        return 1

    if not is_pid_running(pid):
        runtime_paths.pid_file.unlink(missing_ok=True)
        print(f"Removed stale PID file at {runtime_paths.pid_file}")
        return 0

    os.kill(pid, signal.SIGTERM)
    deadline = time.time() + 10
    while time.time() < deadline:
        if not is_pid_running(pid):
            runtime_paths.pid_file.unlink(missing_ok=True)
            print(f"Stopped bridge process {pid}")
            return 0
        time.sleep(0.2)

    print(f"Sent SIGTERM to {pid}, but it is still running")
    return 1


def handle_status(args: argparse.Namespace) -> int:
    runtime_paths = resolve_runtime_paths(args)
    pid = read_pid(runtime_paths.pid_file)
    if pid is None:
        print(f"Bridge is not running (no PID file at {runtime_paths.pid_file})")
        return 1

    if not is_pid_running(pid):
        print(f"Bridge is not running (stale PID file at {runtime_paths.pid_file})")
        return 1

    print(f"Bridge is running with pid {pid}")
    print(f"Log file: {runtime_paths.log_file}")
    print(f"State file: {runtime_paths.state_file}")
    return 0


def read_pid(path: Path) -> Optional[int]:
    if not path.exists():
        return None
    try:
        return int(path.read_text(encoding="utf-8").strip())
    except ValueError:
        return None


def build_watch_command(config: BridgeConfig) -> list[str]:
    command = [
        sys.executable,
        "-m",
        "clawlink_openclaw_bridge",
        "watch",
        "--state-file",
        str(config.state_file),
        "--pid-file",
        str(config.pid_file),
        "--log-file",
        str(config.log_file),
        "--log-level",
        config.log_level,
    ]
    if config.openclaw_agent_id:
        command.extend(["--openclaw-agent-id", config.openclaw_agent_id])
    if config.openclaw_model:
        command.extend(["--openclaw-model", config.openclaw_model])
    if config.openclaw_thinking:
        command.extend(["--openclaw-thinking", config.openclaw_thinking])
    if config.openclaw_timeout_seconds is not None:
        command.extend(["--openclaw-timeout-seconds", str(config.openclaw_timeout_seconds)])
    if config.prompt_template_path:
        command.extend(["--prompt-template", str(config.prompt_template_path)])
    return command


def build_watch_env(config: BridgeConfig) -> dict[str, str]:
    env = os.environ.copy()
    env.update(
        {
            env_name("SUPABASE_URL"): config.supabase_url,
            env_name("SUPABASE_ANON_KEY"): config.supabase_anon_key,
            env_name("ROOM_CHANNEL_ID"): config.room_channel_id,
            env_name("LOCAL_AGENT_LABEL"): config.local_agent_label,
            env_name("OPENCLAW_GATEWAY_URL"): parent_url(config.openclaw_agent_hook_url),
            env_name("OPENCLAW_HOOK_PATH"): hook_path(config.openclaw_agent_hook_url),
            env_name("OPENCLAW_HOOK_TOKEN"): config.openclaw_hook_token,
            env_name("OPENCLAW_NAME"): config.openclaw_name,
        }
    )
    if config.openclaw_agent_id:
        env[env_name("OPENCLAW_AGENT_ID")] = config.openclaw_agent_id
    if config.openclaw_model:
        env[env_name("OPENCLAW_MODEL")] = config.openclaw_model
    if config.openclaw_thinking:
        env[env_name("OPENCLAW_THINKING")] = config.openclaw_thinking
    if config.openclaw_timeout_seconds is not None:
        env[env_name("OPENCLAW_TIMEOUT_SECONDS")] = str(config.openclaw_timeout_seconds)
    return env


def parent_url(full_hook_url: str) -> str:
    if "/hooks/" not in full_hook_url:
        return full_hook_url.rstrip("/")
    return full_hook_url.split("/hooks/", 1)[0].rstrip("/")


def hook_path(full_hook_url: str) -> str:
    if "/hooks/" not in full_hook_url:
        return DEFAULT_OPENCLAW_HOOK_PATH
    return "/hooks/" + full_hook_url.split("/hooks/", 1)[1].lstrip("/")


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.handler(args)
