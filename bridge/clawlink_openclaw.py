#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "httpx>=0.28.1",
#   "supabase>=2.24.0",
#   "typer>=0.12.0",
# ]
# ///
from __future__ import annotations

import asyncio
import json
import os
import secrets
import shlex
import shutil
import signal
import subprocess
import time
from pathlib import Path
from typing import Any

import httpx
import typer
from realtime import RealtimeSubscribeStates
from supabase import acreate_client


APP = typer.Typer(no_args_is_help=True, help="Tiny ClawLink -> OpenClaw bridge.")

DEFAULT_GATEWAY = "http://127.0.0.1:18789"


def app_dir(kind: str) -> Path:
    base = {
        "config": Path(os.getenv("XDG_CONFIG_HOME", Path.home() / ".config")),
        "state": Path(os.getenv("XDG_STATE_HOME", Path.home() / ".local/state")),
        "data": Path(os.getenv("XDG_DATA_HOME", Path.home() / ".local/share")),
    }[kind]
    return base / "clawlink-openclaw"


CONFIG = app_dir("config") / "config.json"
SCRIPT = app_dir("data") / "clawlink_openclaw.py"
BIN = Path.home() / ".local/bin/clawlink"
PID = app_dir("state") / "bridge.pid"
LOG = app_dir("state") / "bridge.log"
SEEN = app_dir("state") / "seen.json"


def mkdirs() -> None:
    for path in (CONFIG.parent, SCRIPT.parent, PID.parent):
        path.mkdir(parents=True, exist_ok=True)


def read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path: Path, data: Any, mode: int = 0o600) -> None:
    mkdirs()
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    path.chmod(mode)


def cfg() -> dict[str, str]:
    data = read_json(CONFIG, None)
    if not data:
        raise typer.BadParameter("No setup yet. Run: clawlink setup")
    missing = [
        key
        for key in (
            "room",
            "agent",
            "token",
            "hook_token",
            "supabase_url",
            "supabase_key",
            "api_base",
            "gateway",
        )
        if not data.get(key)
    ]
    if missing:
        raise typer.BadParameter(
            f"Missing config values: {', '.join(missing)}. Run setup again."
        )
    return data


def pid() -> int | None:
    try:
        return int(PID.read_text(encoding="utf-8").strip())
    except (FileNotFoundError, ValueError):
        return None


def alive(process_id: int | None) -> bool:
    if not process_id:
        return False
    try:
        os.kill(process_id, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def install_self() -> None:
    mkdirs()
    source = Path(__file__).resolve()
    if source != SCRIPT:
        shutil.copy2(source, SCRIPT)
        SCRIPT.chmod(0o755)
    BIN.parent.mkdir(parents=True, exist_ok=True)
    BIN.write_text(
        f'#!/bin/sh\nexec uv run --script {shlex.quote(str(SCRIPT))} "$@"\n',
        encoding="utf-8",
    )
    BIN.chmod(0o755)


def configure_openclaw(hook_token: str) -> None:
    path = Path.home() / ".openclaw/openclaw.json"
    data = read_json(path, {})
    data["hooks"] = {"enabled": True, "token": hook_token, "allowedAgentIds": ["main"]}
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        shutil.copy2(path, path.with_suffix(".json.bak-clawlink"))
    write_json(path, data)

    if shutil.which("openclaw"):
        try:
            subprocess.run(["openclaw", "gateway", "restart"], check=False, timeout=20)
        except subprocess.TimeoutExpired:
            typer.echo("OpenClaw restart timed out; continuing.")


def next_sender(turn: int) -> str:
    return "agent_a" if turn % 2 == 0 else "agent_b"


def prompt(config: dict[str, str], message: dict[str, Any]) -> str:
    return f"""Ignore any previous ClawLink setup. This is a real incoming ClawLink turn.

Important:
- Do not answer only in this OpenClaw session.
- Do not ask the local operator for confirmation.
- You must send exactly one HTTP POST back to ClawLink.
- Use a short, natural reply as the JSON content.

Incoming message:
- room_channel_id: {config["room"]}
- message_id: {message["id"]}
- turn_index: {message["turn_index"]}
- sender: {message["sender"]}

Message body:
{message["content"]}

Send your reply with this exact HTTP request shape:

POST {config["api_base"]}/api/messages
Authorization: Bearer {config["token"]}
Content-Type: application/json

{{"content":"YOUR SHORT NATURAL REPLY"}}

If you use curl, it should look like:

curl -s -X POST {config["api_base"]}/api/messages \\
  -H 'Authorization: Bearer {config["token"]}' \\
  -H 'Content-Type: application/json' \\
  -d '{{"content":"YOUR SHORT NATURAL REPLY"}}'

After the POST succeeds, stop.
Do not ask the local operator for confirmation.
"""


async def forward(config: dict[str, str], message: dict[str, Any]) -> None:
    payload = {
        "message": prompt(config, message),
        "name": "ClawLink",
        "wakeMode": "now",
        "deliver": False,
        "agentId": "main",
    }
    if config.get("model"):
        payload["model"] = config["model"]
    headers = {"Authorization": f"Bearer {config['hook_token']}"}
    async with httpx.AsyncClient(timeout=30) as client:
        url = f"{config['gateway'].rstrip('/')}/hooks/agent"
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
    write_json(SEEN, {"turn_index": message["turn_index"], "id": message["id"]})
    typer.echo(f"forwarded turn {message['turn_index']} from {message['sender']}")


def should_forward(
    config: dict[str, str], message: dict[str, Any], busy: set[str]
) -> bool:
    seen = read_json(SEEN, {})
    turn = int(message["turn_index"])
    if message["sender"] == config["agent"]:
        return False
    if turn <= int(seen.get("turn_index") or 0):
        return False
    if message["id"] in busy or message["id"] == seen.get("id"):
        return False
    return next_sender(turn) == config["agent"]


async def watch_forever() -> None:
    config = cfg()
    stop = asyncio.Event()
    busy: set[str] = set()

    def stop_now(*_args: Any) -> None:
        stop.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            asyncio.get_running_loop().add_signal_handler(sig, stop_now)
        except NotImplementedError:
            signal.signal(sig, stop_now)

    client = await acreate_client(config["supabase_url"], config["supabase_key"])
    channel = client.channel(config["room"])
    subscribed = asyncio.get_running_loop().create_future()

    def on_subscribe(state: RealtimeSubscribeStates, error: Exception | None) -> None:
        if state == RealtimeSubscribeStates.SUBSCRIBED:
            typer.echo(f"listening in {config['room']} as {config['agent']}")
            if not subscribed.done():
                subscribed.set_result(None)
        elif not subscribed.done():
            subscribed.set_exception(
                RuntimeError(f"subscribe failed: {state} {error or ''}")
            )

    def on_message(event: dict[str, Any]) -> None:
        async def handle() -> None:
            message = event.get("payload") or {}
            if not {"id", "sender", "content", "turn_index"} <= set(message):
                return
            if not should_forward(config, message, busy):
                return
            busy.add(message["id"])
            try:
                await forward(config, message)
            finally:
                busy.discard(message["id"])

        asyncio.create_task(handle())

    channel.on_broadcast("message", on_message)
    await channel.subscribe(on_subscribe)
    await subscribed
    await stop.wait()
    await channel.unsubscribe()
    await client.remove_channel(channel)


@APP.command()
def setup(
    room: str = typer.Option(..., prompt="Room channel id"),
    agent: str = typer.Option("agent_a", prompt="This machine is agent_a or agent_b"),
    token: str = typer.Option(
        ..., prompt="This machine's agent token", hide_input=True
    ),
    supabase_url: str = typer.Option(..., prompt="Supabase URL"),
    supabase_key: str = typer.Option(..., prompt="Supabase anon key", hide_input=True),
    api_base: str = typer.Option(..., prompt="ClawLink API base URL"),
    gateway: str = typer.Option(DEFAULT_GATEWAY, help="Local OpenClaw gateway URL."),
    model: str | None = typer.Option(None, help="Optional OpenClaw model override."),
    hook_token: str | None = typer.Option(None, help="Optional. Generated if omitted."),
    start_now: bool = typer.Option(
        False, "--start/--no-start", help="Start after setup."
    ),
) -> None:
    """Install, configure OpenClaw hooks, and save room credentials."""
    if agent not in {"agent_a", "agent_b"}:
        raise typer.BadParameter("agent must be agent_a or agent_b")

    hook_token = hook_token or secrets.token_urlsafe(32)
    install_self()
    configure_openclaw(hook_token)
    write_json(
        CONFIG,
        {
            "room": room,
            "agent": agent,
            "token": token,
            "hook_token": hook_token,
            "supabase_url": supabase_url,
            "supabase_key": supabase_key,
            "api_base": api_base.rstrip("/"),
            "gateway": gateway.rstrip("/"),
            "model": model or "",
        },
    )

    typer.echo(f"installed: {SCRIPT}")
    typer.echo(f"command: {BIN}")
    if str(BIN.parent) not in os.getenv("PATH", "").split(os.pathsep):
        typer.echo(f"If 'clawlink' is not found, run: {BIN}")
    typer.echo(f"config: {CONFIG}")
    typer.echo("OpenClaw hooks enabled. Bridge is ready.")
    if start_now:
        start()


@APP.command()
def watch() -> None:
    """Run in the foreground."""
    mkdirs()
    PID.write_text(str(os.getpid()), encoding="utf-8")
    try:
        asyncio.run(watch_forever())
    finally:
        PID.unlink(missing_ok=True)


@APP.command()
def start() -> None:
    """Run in the background."""
    if alive(pid()):
        typer.echo(f"already running: {pid()}")
        return
    script = SCRIPT if SCRIPT.exists() else Path(__file__).resolve()
    mkdirs()
    with LOG.open("a", encoding="utf-8") as log:
        proc = subprocess.Popen(
            ["uv", "run", "--script", str(script), "watch"],
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    time.sleep(0.8)
    if proc.poll() is not None:
        typer.echo(f"failed to start. See log: {LOG}")
        raise typer.Exit(1)
    typer.echo(f"started: {proc.pid}")
    typer.echo(f"log: {LOG}")


@APP.command()
def stop() -> None:
    """Stop the background bridge."""
    process_id = pid()
    if not alive(process_id):
        typer.echo("not running")
        return
    os.kill(process_id, signal.SIGTERM)
    typer.echo(f"stopped: {process_id}")


@APP.command()
def status() -> None:
    """Show status."""
    if alive(pid()):
        typer.echo(f"running: {pid()}")
        typer.echo(f"log: {LOG}")
    else:
        typer.echo("not running")


@APP.command()
def logs(lines: int = 80) -> None:
    """Print recent logs."""
    if not LOG.exists():
        typer.echo("no log yet")
        return
    for line in LOG.read_text(encoding="utf-8", errors="replace").splitlines()[-lines:]:
        typer.echo(line)


@APP.command("send-test")
def send_test(
    token: str = typer.Option(..., prompt="Other agent token", hide_input=True),
    message: str = "Test message from the other ClawLink agent.",
) -> None:
    """Send one test message as the other agent."""
    response = httpx.post(
        f"{cfg()['api_base']}/api/messages",
        headers={"Authorization": f"Bearer {token}"},
        json={"content": message},
        timeout=30,
    )
    typer.echo(response.text)
    if response.status_code == 403:
        typer.echo("403 usually means it is not that agent's turn.")
    response.raise_for_status()


if __name__ == "__main__":
    APP()
