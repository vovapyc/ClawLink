from __future__ import annotations

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
from typing import Any, Optional

import httpx
import typer
from realtime import RealtimeSubscribeStates
from supabase import acreate_client


LOGGER = logging.getLogger("clawlink-openclaw-bridge")
app = typer.Typer(no_args_is_help=True)

ENV_PREFIX = "CLAWLINK_"
DEFAULT_GATEWAY_URL = "http://127.0.0.1:18789"
DEFAULT_HOOK_PATH = "/hooks/agent"
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

Reply instructions:
{delivery_instructions}

Raw payload:
{message_json}
"""


@dataclass(frozen=True)
class Config:
    supabase_url: Optional[str]
    supabase_anon_key: Optional[str]
    api_base_url: Optional[str]
    agent_token: Optional[str]
    room_channel_id: Optional[str]
    local_agent_label: Optional[str]
    openclaw_gateway_url: str
    openclaw_hook_path: str
    openclaw_hook_token: Optional[str]
    openclaw_name: str
    openclaw_agent_id: Optional[str]
    openclaw_model: Optional[str]
    openclaw_thinking: Optional[str]
    openclaw_timeout_seconds: Optional[int]
    prompt_template_path: Optional[Path]
    state_file: Optional[Path]
    pid_file: Optional[Path]
    log_file: Optional[Path]
    log_level: str

    def require_watch_values(self) -> None:
        require(self.supabase_url, "--supabase-url")
        require(self.supabase_anon_key, "--supabase-anon-key")
        require(self.room_channel_id, "--room-channel-id")
        require(self.local_agent_label, "--local-agent-label")
        require(self.openclaw_hook_token, "--openclaw-hook-token")
        self.require_valid_agent_label()

    def require_runtime_values(self) -> None:
        require(self.room_channel_id, "--room-channel-id")
        require(self.local_agent_label, "--local-agent-label")
        self.require_valid_agent_label()

    def require_valid_agent_label(self) -> None:
        if self.local_agent_label not in {"agent_a", "agent_b"}:
            raise typer.BadParameter("--local-agent-label must be agent_a or agent_b")

    @property
    def hook_url(self) -> str:
        return join_url(self.openclaw_gateway_url, self.openclaw_hook_path)

    @property
    def state_path(self) -> Path:
        return self.state_file or runtime_path(self.room_channel_id, self.local_agent_label, "state.json")

    @property
    def pid_path(self) -> Path:
        return self.pid_file or runtime_path(self.room_channel_id, self.local_agent_label, "pid")

    @property
    def log_path(self) -> Path:
        return self.log_file or runtime_path(self.room_channel_id, self.local_agent_label, "log")


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
    raw_payload: dict[str, Any]


def env_name(suffix: str) -> str:
    return f"{ENV_PREFIX}{suffix}"


def runtime_dir() -> Path:
    state_home = os.environ.get("XDG_STATE_HOME")
    if state_home:
        return Path(state_home).expanduser() / "clawlink-openclaw-bridge"
    return Path.home() / ".local" / "state" / "clawlink-openclaw-bridge"


def runtime_path(room_channel_id: Optional[str], local_agent_label: Optional[str], suffix: str) -> Path:
    slug = sanitize(f"{room_channel_id or 'room'}-{local_agent_label or 'agent'}")
    return runtime_dir() / f"{slug}.{suffix}"


def sanitize(value: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in value)
    return cleaned.strip("-") or "room"


def join_url(base: str, path: str) -> str:
    return base.rstrip("/") + "/" + path.lstrip("/")


def require(value: Optional[str], name: str) -> str:
    if not value:
        raise typer.BadParameter(f"Missing required value for {name}")
    return value


def next_expected_sender(turn_index: int) -> str:
    return "agent_a" if turn_index % 2 == 0 else "agent_b"


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        LOGGER.warning("Ignoring invalid JSON state file at %s", path)
        return {}


def write_json(path: Path, payload: dict[str, Any]) -> None:
    ensure_parent(path)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(path)


def read_pid(path: Path) -> Optional[int]:
    if not path.exists():
        return None
    try:
        return int(path.read_text(encoding="utf-8").strip())
    except ValueError:
        return None


def pid_running(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def configure_logging(level: str, log_file: Optional[Path] = None) -> None:
    handler: logging.Handler
    if log_file:
        ensure_parent(log_file)
        handler = logging.FileHandler(log_file, encoding="utf-8")
    else:
        handler = logging.StreamHandler()

    logging.basicConfig(
        level=getattr(logging, level.upper()),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[handler],
        force=True,
    )


class Bridge:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.stop_event = asyncio.Event()
        self.state_lock = asyncio.Lock()
        self.inflight: set[str] = set()
        self.state = read_json(config.state_path)
        self.prompt_template = self.load_prompt_template()

    def load_prompt_template(self) -> str:
        if self.config.prompt_template_path:
            return self.config.prompt_template_path.read_text(encoding="utf-8")
        return DEFAULT_PROMPT_TEMPLATE

    async def run(self) -> int:
        ensure_parent(self.config.pid_path)
        self.config.pid_path.write_text(str(os.getpid()), encoding="utf-8")
        self.install_signal_handlers()
        try:
            await self.watch()
        finally:
            self.config.pid_path.unlink(missing_ok=True)
        return 0

    def install_signal_handlers(self) -> None:
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, self.stop_event.set)
            except NotImplementedError:
                signal.signal(sig, lambda *_args: self.stop_event.set())

    async def watch(self) -> None:
        LOGGER.info("Watching Supabase channel %s as %s", self.config.room_channel_id, self.config.local_agent_label)
        client = await acreate_client(require(self.config.supabase_url, "--supabase-url"), require(self.config.supabase_anon_key, "--supabase-anon-key"))
        channel = client.channel(require(self.config.room_channel_id, "--room-channel-id"))
        subscribed = asyncio.get_running_loop().create_future()

        def on_subscribe(state: RealtimeSubscribeStates, error: Optional[Exception]) -> None:
            state_name = getattr(state, "value", str(state))
            if state == RealtimeSubscribeStates.SUBSCRIBED:
                LOGGER.info("Subscribed to Supabase Realtime channel %s", self.config.room_channel_id)
                if not subscribed.done():
                    subscribed.set_result(None)
                return
            if subscribed.done():
                log = LOGGER.error if error else LOGGER.warning
                log("Subscription state changed: %s%s", state_name, f": {error}" if error else "")
                return
            subscribed.set_exception(RuntimeError(f"Supabase subscribe failed with {state_name}: {error or ''}".strip()))

        def on_broadcast(envelope: dict[str, Any]) -> None:
            asyncio.create_task(self.handle_broadcast(envelope))

        channel.on_broadcast("message", on_broadcast)
        await channel.subscribe(on_subscribe)
        await subscribed

        try:
            await self.stop_event.wait()
        finally:
            await channel.unsubscribe()
            await client.remove_channel(channel)

    async def handle_broadcast(self, envelope: dict[str, Any]) -> None:
        event = self.parse_event(envelope)
        if not event or not await self.should_dispatch(event):
            return
        try:
            await self.dispatch(event)
        except Exception:
            async with self.state_lock:
                self.inflight.discard(event.message_id)
            LOGGER.exception("Failed to forward turn %s (%s) to OpenClaw", event.turn_index, event.message_id)
            return

        async with self.state_lock:
            self.state = {
                "room_channel_id": event.room_channel_id,
                "room_id": event.room_id,
                "last_turn_index": event.turn_index,
                "last_message_id": event.message_id,
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            self.inflight.discard(event.message_id)
            write_json(self.config.state_path, self.state)
        LOGGER.info("Forwarded turn %s from %s to OpenClaw", event.turn_index, event.sender)

    def parse_event(self, envelope: dict[str, Any]) -> Optional[MessageEvent]:
        payload = envelope.get("payload")
        if not isinstance(payload, dict):
            LOGGER.debug("Ignoring malformed broadcast envelope: %r", envelope)
            return None

        required = {"id", "room_id", "sender", "content", "turn_index"}
        missing = required.difference(payload)
        if missing:
            LOGGER.debug("Ignoring payload missing required fields %s: %r", sorted(missing), payload)
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

        return MessageEvent(
            message_id=str(payload["id"]),
            room_id=str(payload["room_id"]),
            room_channel_id=str(payload.get("room_channel_id") or self.config.room_channel_id),
            sender=sender,
            sender_name=str(payload.get("sender_name") or ""),
            content=str(payload["content"]),
            turn_index=turn_index,
            created_at=str(payload["created_at"]) if payload.get("created_at") else None,
            raw_payload=payload,
        )

    async def should_dispatch(self, event: MessageEvent) -> bool:
        async with self.state_lock:
            last_turn = int(self.state.get("last_turn_index") or 0)
            last_message = self.state.get("last_message_id")

            if event.sender == self.config.local_agent_label:
                LOGGER.debug("Ignoring turn %s because sender %s is local", event.turn_index, event.sender)
                return False
            if event.turn_index <= last_turn:
                LOGGER.debug("Ignoring turn %s because last seen turn is %s", event.turn_index, last_turn)
                return False
            if event.message_id == last_message or event.message_id in self.inflight:
                LOGGER.debug("Ignoring message %s because it is already handled", event.message_id)
                return False
            if next_expected_sender(event.turn_index) != self.config.local_agent_label:
                LOGGER.debug("Ignoring turn %s because next sender is not %s", event.turn_index, self.config.local_agent_label)
                return False

            self.inflight.add(event.message_id)
            return True

    async def dispatch(self, event: MessageEvent) -> None:
        prompt = self.render_prompt(event)
        headers = {
            "Authorization": f"Bearer {require(self.config.openclaw_hook_token, '--openclaw-hook-token')}",
            "Content-Type": "application/json",
        }
        payload: dict[str, Any] = {
            "message": prompt,
            "name": self.config.openclaw_name,
            "wakeMode": "now",
            "deliver": False,
        }
        for key, value in {
            "agentId": self.config.openclaw_agent_id,
            "model": self.config.openclaw_model,
            "thinking": self.config.openclaw_thinking,
            "timeoutSeconds": self.config.openclaw_timeout_seconds,
        }.items():
            if value is not None:
                payload[key] = value
        await self.post_json(self.config.hook_url, headers, payload, "OpenClaw")

    async def post_json(self, url: str, headers: dict[str, str], payload: dict[str, Any], label: str) -> None:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            LOGGER.debug("%s response: %s", label, response.text)

    def render_prompt(self, event: MessageEvent) -> str:
        return self.prompt_template.format(
            delivery_instructions=self.delivery_instructions(),
            message_id=event.message_id,
            room_id=event.room_id,
            room_channel_id=event.room_channel_id,
            sender=event.sender,
            sender_name=event.sender_name,
            content=event.content,
            body=event.content,
            turn_index=event.turn_index,
            created_at=event.created_at or "",
            message_json=json.dumps(event.raw_payload, ensure_ascii=False, indent=2, sort_keys=True),
        )

    def delivery_instructions(self) -> str:
        if not self.config.api_base_url or not self.config.agent_token:
            return (
                "Reply to the other agent normally. Bridge delivery credentials were not configured, "
                "so ask the operator to wire in CLAWLINK_API_BASE_URL and CLAWLINK_AGENT_TOKEN if you need to post automatically."
            )

        api_base = self.config.api_base_url.rstrip("/")
        return (
            "You should answer the other ClawLink agent, not the local operator. "
            f"Write a concise reply, then POST it to {api_base}/api/messages with "
            f"Authorization: Bearer {self.config.agent_token}. "
            'Use JSON with only one field: {"content": "YOUR_REPLY_HERE"}.'
        )


def config_env(config: Config) -> dict[str, str]:
    env = os.environ.copy()
    values = {
        "SUPABASE_URL": config.supabase_url,
        "SUPABASE_ANON_KEY": config.supabase_anon_key,
        "API_BASE_URL": config.api_base_url,
        "AGENT_TOKEN": config.agent_token,
        "ROOM_CHANNEL_ID": config.room_channel_id,
        "LOCAL_AGENT_LABEL": config.local_agent_label,
        "OPENCLAW_GATEWAY_URL": config.openclaw_gateway_url,
        "OPENCLAW_HOOK_PATH": config.openclaw_hook_path,
        "OPENCLAW_HOOK_TOKEN": config.openclaw_hook_token,
        "OPENCLAW_NAME": config.openclaw_name,
        "OPENCLAW_AGENT_ID": config.openclaw_agent_id,
        "OPENCLAW_MODEL": config.openclaw_model,
        "OPENCLAW_THINKING": config.openclaw_thinking,
        "OPENCLAW_TIMEOUT_SECONDS": str(config.openclaw_timeout_seconds) if config.openclaw_timeout_seconds is not None else None,
        "PROMPT_TEMPLATE": str(config.prompt_template_path) if config.prompt_template_path else None,
        "STATE_FILE": str(config.state_path),
        "PID_FILE": str(config.pid_path),
        "LOG_FILE": str(config.log_path),
        "LOG_LEVEL": config.log_level,
    }
    env.update({env_name(key): value for key, value in values.items() if value})
    return env


def get_config(ctx: typer.Context) -> Config:
    config = ctx.obj
    if not isinstance(config, Config):
        raise typer.BadParameter("Missing CLI configuration")
    return config


@app.callback()
def configure(
    ctx: typer.Context,
    supabase_url: Optional[str] = typer.Option(None, envvar=env_name("SUPABASE_URL")),
    supabase_anon_key: Optional[str] = typer.Option(None, envvar=env_name("SUPABASE_ANON_KEY")),
    api_base_url: Optional[str] = typer.Option(None, envvar=env_name("API_BASE_URL")),
    agent_token: Optional[str] = typer.Option(None, envvar=env_name("AGENT_TOKEN")),
    room_channel_id: Optional[str] = typer.Option(None, envvar=env_name("ROOM_CHANNEL_ID")),
    local_agent_label: Optional[str] = typer.Option(None, envvar=env_name("LOCAL_AGENT_LABEL")),
    openclaw_gateway_url: str = typer.Option(DEFAULT_GATEWAY_URL, envvar=env_name("OPENCLAW_GATEWAY_URL")),
    openclaw_hook_path: str = typer.Option(DEFAULT_HOOK_PATH, envvar=env_name("OPENCLAW_HOOK_PATH")),
    openclaw_hook_token: Optional[str] = typer.Option(None, envvar=env_name("OPENCLAW_HOOK_TOKEN")),
    openclaw_name: str = typer.Option(DEFAULT_OPENCLAW_NAME, envvar=env_name("OPENCLAW_NAME")),
    openclaw_agent_id: Optional[str] = typer.Option(None, envvar=env_name("OPENCLAW_AGENT_ID")),
    openclaw_model: Optional[str] = typer.Option(None, envvar=env_name("OPENCLAW_MODEL")),
    openclaw_thinking: Optional[str] = typer.Option(None, envvar=env_name("OPENCLAW_THINKING")),
    openclaw_timeout_seconds: Optional[int] = typer.Option(None, envvar=env_name("OPENCLAW_TIMEOUT_SECONDS")),
    prompt_template: Optional[Path] = typer.Option(None, envvar=env_name("PROMPT_TEMPLATE")),
    state_file: Optional[Path] = typer.Option(None, envvar=env_name("STATE_FILE")),
    pid_file: Optional[Path] = typer.Option(None, envvar=env_name("PID_FILE")),
    log_file: Optional[Path] = typer.Option(None, envvar=env_name("LOG_FILE")),
    log_level: str = typer.Option("INFO", envvar=env_name("LOG_LEVEL")),
) -> None:
    ctx.obj = Config(
        supabase_url=supabase_url,
        supabase_anon_key=supabase_anon_key,
        api_base_url=api_base_url,
        agent_token=agent_token,
        room_channel_id=room_channel_id,
        local_agent_label=local_agent_label,
        openclaw_gateway_url=openclaw_gateway_url,
        openclaw_hook_path=openclaw_hook_path,
        openclaw_hook_token=openclaw_hook_token,
        openclaw_name=openclaw_name,
        openclaw_agent_id=openclaw_agent_id,
        openclaw_model=openclaw_model,
        openclaw_thinking=openclaw_thinking,
        openclaw_timeout_seconds=openclaw_timeout_seconds,
        prompt_template_path=prompt_template.expanduser() if prompt_template else None,
        state_file=state_file.expanduser() if state_file else None,
        pid_file=pid_file.expanduser() if pid_file else None,
        log_file=log_file.expanduser() if log_file else None,
        log_level=log_level,
    )


@app.command()
def watch(ctx: typer.Context) -> None:
    config = get_config(ctx)
    config.require_watch_values()
    configure_logging(config.log_level)
    raise typer.Exit(asyncio.run(Bridge(config).run()))


@app.command()
def start(ctx: typer.Context) -> None:
    config = get_config(ctx)
    config.require_watch_values()
    configure_logging(config.log_level)

    existing_pid = read_pid(config.pid_path)
    if existing_pid and pid_running(existing_pid):
        typer.echo(f"Bridge already running with pid {existing_pid}")
        return
    if existing_pid:
        config.pid_path.unlink(missing_ok=True)

    ensure_parent(config.log_path)
    with open(config.log_path, "a", encoding="utf-8") as log_handle:
        proc = subprocess.Popen(
            [sys.executable, "-m", "clawlink_openclaw_bridge", "watch"],
            env=config_env(config),
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )

    time.sleep(0.5)
    if proc.poll() is not None:
        typer.echo(f"Bridge failed to start. Check log file: {config.log_path}")
        raise typer.Exit(1)

    typer.echo(f"Bridge started in background (pid {proc.pid})")
    typer.echo(f"PID file: {config.pid_path}")
    typer.echo(f"Log file: {config.log_path}")


@app.command()
def stop(ctx: typer.Context) -> None:
    config = get_config(ctx)
    config.require_runtime_values()
    pid = read_pid(config.pid_path)
    if pid is None:
        typer.echo(f"No PID file found at {config.pid_path}")
        raise typer.Exit(1)
    if not pid_running(pid):
        config.pid_path.unlink(missing_ok=True)
        typer.echo(f"Removed stale PID file at {config.pid_path}")
        return

    os.kill(pid, signal.SIGTERM)
    deadline = time.time() + 10
    while time.time() < deadline:
        if not pid_running(pid):
            config.pid_path.unlink(missing_ok=True)
            typer.echo(f"Stopped bridge process {pid}")
            return
        time.sleep(0.2)

    typer.echo(f"Sent SIGTERM to {pid}, but it is still running")
    raise typer.Exit(1)


@app.command()
def status(ctx: typer.Context) -> None:
    config = get_config(ctx)
    config.require_runtime_values()
    pid = read_pid(config.pid_path)
    if pid is None:
        typer.echo(f"Bridge is not running (no PID file at {config.pid_path})")
        raise typer.Exit(1)
    if not pid_running(pid):
        typer.echo(f"Bridge is not running (stale PID file at {config.pid_path})")
        raise typer.Exit(1)

    typer.echo(f"Bridge is running with pid {pid}")
    typer.echo(f"Log file: {config.log_path}")
    typer.echo(f"State file: {config.state_path}")


def main() -> None:
    app()
