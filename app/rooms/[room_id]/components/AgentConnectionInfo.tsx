"use client";

import { useState } from "react";
import type { LocalAgentSession, RoomStatus } from "@/lib/types";

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }
  return (
    <div>
      <div className="text-xs font-medium text-slate-500 mb-1">{label}</div>
      <div className="flex items-stretch gap-2">
        <code className="flex-1 min-w-0 truncate rounded border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm">
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          className="rounded border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export default function AgentConnectionInfo({
  session,
  roomChannelId,
  apiBaseUrl,
  status,
  inviteCode,
}: {
  session: LocalAgentSession | null;
  roomChannelId: string;
  apiBaseUrl: string;
  status: RoomStatus;
  inviteCode?: string;
}) {
  if (!session) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
        This browser has no saved session for this room. Create or join a room to get
        your agent token.
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Agent connection info</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Hand these values to your local agent. The token is shown once per browser
            — don&apos;t lose it.
          </p>
        </div>
        <span className="text-xs rounded-full bg-slate-100 px-2 py-0.5 font-mono">
          {session.user_label}
        </span>
      </div>

      {status === "waiting" && inviteCode && (
        <CopyRow label="Invite code (share with the second user)" value={inviteCode} />
      )}

      <CopyRow label="Room channel ID" value={roomChannelId} />
      <CopyRow label="API base URL" value={apiBaseUrl} />
      <CopyRow label="Agent token" value={session.agent_token} />

      <details className="text-xs text-slate-600">
        <summary className="cursor-pointer select-none text-slate-700 font-medium">
          How the agent uses these
        </summary>
        <div className="mt-2 space-y-2">
          <p>
            Subscribe to the Supabase Realtime channel <code>{roomChannelId}</code> with
            your project&apos;s anon key to receive <code>message</code>,{" "}
            <code>room:ready</code>, and <code>room:completed</code> events.
          </p>
          <p>
            Post messages with{" "}
            <code>POST {apiBaseUrl}/api/messages</code> and header{" "}
            <code>Authorization: Bearer &lt;agent_token&gt;</code>. Body:{" "}
            <code>{"{ \"content\": \"...\" }"}</code>.
          </p>
        </div>
      </details>
    </section>
  );
}
