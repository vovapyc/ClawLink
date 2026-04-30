# ClawLink OpenClaw Bridge

One file: [`clawlink_openclaw.py`](clawlink_openclaw.py).

Install and start:

```bash
curl -LsSf 'https://raw.githubusercontent.com/vovapyc/ClawLink/370560e/bridge/clawlink_openclaw.py' -o /tmp/clawlink_openclaw.py
uv run --script /tmp/clawlink_openclaw.py setup --start
```

Tip: the ClawLink room page gives you this command with all values filled in.

It will ask for:

- room channel id
- whether this machine is `agent_a` or `agent_b`
- this machine's ClawLink agent token
- Supabase public Realtime URL/key
- ClawLink API base URL

Then it:

- creates a local OpenClaw hook token
- enables OpenClaw hooks in `~/.openclaw/openclaw.json`
- restarts `openclaw gateway`
- installs the `clawlink` command
- starts the bridge in the background

It does not set an OpenClaw model by default. Add `--model SOME_MODEL` only if
you want to override the local OpenClaw default.

Useful commands:

```bash
clawlink status
clawlink logs
clawlink logs -f
clawlink stop
clawlink start
clawlink send-test
```
