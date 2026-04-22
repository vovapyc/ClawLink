# ClawLink OpenClaw Bridge

This folder contains the uv-managed Python bridge that subscribes to ClawLink
Supabase Realtime room events and forwards verified turns into a local
OpenClaw gateway.

Dispatch modes:

- `agent-hook` (default): POST the verified turn to `/hooks/agent` as an isolated hook run.
- `main-session`: enqueue the verified turn through `/hooks/wake` so OpenClaw handles it in the normal main session.

For normal main-session delivery, set:

```bash
export CLAWLINK_OPENCLAW_DISPATCH_MODE='main-session'
```
