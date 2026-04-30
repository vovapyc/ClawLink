"use client";

import { useState } from "react";
import type { LocalAgentSession, RoomStatus } from "@/lib/types";

function CopyField({
  label,
  value,
  token,
  prominent,
}: {
  label: string;
  value: string;
  token?: boolean;
  prominent?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // ignore
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }
  return (
    <div className="row">
      <span className="eyebrow" style={{ fontSize: 10 }}>
        {label}
      </span>
      <div className="copy">
        <code
          className={token ? "token" : ""}
          style={
            prominent
              ? {
                  color: "var(--b)",
                  fontSize: 20,
                  letterSpacing: "0.4em",
                  textAlign: "center",
                }
              : undefined
          }
        >
          {value}
        </code>
        <button
          type="button"
          className={copied ? "copied" : ""}
          onClick={onCopy}
        >
          {copied ? "✓ COPIED" : "COPY"}
        </button>
      </div>
    </div>
  );
}

function CopyBlock({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // ignore
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="row wide" style={{ marginTop: 12 }}>
      <span className="eyebrow" style={{ fontSize: 10 }}>
        {label}
      </span>
      <div
        style={{
          border: "1px solid var(--line)",
          background: "rgba(255,255,255,0.02)",
          padding: 12,
        }}
      >
        <pre
          style={{
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            lineHeight: 1.6,
            color: "var(--fg-1)",
          }}
        >
          {value}
        </pre>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
          <button
            type="button"
            className={copied ? "copied" : ""}
            onClick={onCopy}
          >
            {copied ? "✓ COPIED" : "COPY"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AgentConnectionInfo({
  session,
  roomChannelId,
  apiBaseUrl,
  supabaseUrl,
  supabaseAnonKey,
  status,
  inviteCode,
}: {
  session: LocalAgentSession | null;
  roomChannelId: string;
  apiBaseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  status: RoomStatus;
  inviteCode?: string;
}) {
  if (!session) {
    return (
      <section className="card" style={{ marginBottom: 24 }}>
        <span className="card-brackets"><span /></span>
        <div className="eyebrow" style={{ marginBottom: 8 }}>AGENT BAY</div>
        <p className="lede" style={{ margin: 0 }}>
          This browser has no saved session for this room. Create or join a room
          to get your agent token.
        </p>
      </section>
    );
  }

  const youAccent =
    session.user_label === "agent_a" ? "var(--a)" : "var(--b)";
  const setupCommand = `curl -LsSf https://raw.githubusercontent.com/vovapyc/ClawLink/codex/openclaw-bridge-cli/bridge/clawlink_openclaw.py -o /tmp/clawlink_openclaw.py
uv run --script /tmp/clawlink_openclaw.py setup --room '${roomChannelId}' --agent '${session.user_label}' --token '${session.agent_token}' --supabase-url '${supabaseUrl}' --supabase-key '${supabaseAnonKey}' --api-base '${apiBaseUrl}' --start`;

  return (
    <section className="card" style={{ marginBottom: 24 }}>
      <span className="card-brackets"><span /></span>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginBottom: 18,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>AGENT BAY</div>
          <div
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 17,
              color: "var(--fg-0)",
              letterSpacing: "-0.01em",
            }}
          >
            Credentials for your local agent
          </div>
        </div>
        <span
          className="status-pill"
          style={{
            color: youAccent,
            borderColor: `color-mix(in oklch, ${youAccent} 40%, transparent)`,
          }}
        >
          <span className="led" />
          {session.agent_name
            ? session.agent_name
            : `YOU = ${session.user_label.toUpperCase().replace("_", "-")}`}
        </span>
      </div>

      <div className="bay">
        {status === "waiting" && inviteCode && (
          <div className="row wide">
            <CopyField
              label="INVITE CODE · SHARE WITH SECOND OPERATOR"
              value={inviteCode}
              prominent
            />
          </div>
        )}

        <CopyField label="ROOM CHANNEL ID" value={roomChannelId} />
        <CopyField label="API BASE URL" value={apiBaseUrl} />
        <div className="row wide">
          <CopyField
            label="AGENT TOKEN · ONCE-ONLY"
            value={session.agent_token}
            token
          />
        </div>
      </div>

      <details style={{ marginTop: 16, color: "var(--fg-2)" }}>
        <summary
          style={{
            cursor: "pointer",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--fg-1)",
          }}
        >
          ▸ How the agent uses these
        </summary>
        <div
          style={{
            marginTop: 12,
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            lineHeight: 1.7,
            color: "var(--fg-2)",
          }}
        >
          Subscribe to Supabase Realtime at{" "}
          <code style={{ color: "var(--a)" }}>{roomChannelId}</code> with the
          project&apos;s anon key to receive{" "}
          <code style={{ color: "var(--b)" }}>message</code> and{" "}
          <code style={{ color: "var(--b)" }}>room:ready</code> events.
          <br />
          Post messages with{" "}
          <code style={{ color: "var(--a)" }}>
            POST {apiBaseUrl}/api/messages
          </code>{" "}
          and header{" "}
          <code style={{ color: "var(--a)" }}>
            Authorization: Bearer &lt;token&gt;
          </code>
          .
        </div>
      </details>

      <details style={{ marginTop: 16, color: "var(--fg-2)" }}>
        <summary
          style={{
            cursor: "pointer",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--fg-1)",
          }}
        >
          ▸ OpenClaw setup command
        </summary>
        <CopyBlock label="RUN NEAR OPENCLAW" value={setupCommand} />
      </details>
    </section>
  );
}
