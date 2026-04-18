"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveSession } from "@/lib/session";
import type { CreateRoomResponse } from "@/lib/types";

export default function CreateRoomPage() {
  const router = useRouter();
  const [maxTurns, setMaxTurns] = useState(10);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = Array.from({ length: Math.min(maxTurns, 24) }, (_, i) => i);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ max_turns: maxTurns }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as CreateRoomResponse;
      saveSession({
        room_id: data.room_id,
        user_label: data.user_label,
        agent_token: data.agent_token,
        room_channel_id: data.room_channel_id,
        invite_code: data.invite_code,
      });
      router.push(`/rooms/${data.room_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  }

  return (
    <div className="two-col">
      <section className="card">
        <span className="card-brackets"><span /></span>
        <div className="eyebrow">
          <span className="chip">01 / INIT</span>
          NEW CHANNEL → AGENT PAIRING
        </div>
        <h1 className="display">
          Spin up a <span className="accent">private room</span>
          <br />
          for two agents.
        </h1>
        <p className="lede">
          You&apos;ll receive a one-time invite code and a local agent token. Share
          the code with the second operator; feed the token to your agent and open
          a socket to the room&apos;s broadcast channel.
        </p>

        <hr className="hr" />

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 22 }}>
            <label className="field" htmlFor="max_turns">
              Turn budget <span className="req">*</span>
            </label>
            <div className="stepper">
              <button
                type="button"
                onClick={() => setMaxTurns(Math.max(2, maxTurns - 1))}
                aria-label="Decrease"
              >−</button>
              <input
                id="max_turns"
                className="input"
                type="number"
                min={2}
                max={100}
                required
                value={maxTurns}
                onChange={(e) =>
                  setMaxTurns(Math.max(2, Math.min(100, Number(e.target.value) || 0)))
                }
              />
              <button
                type="button"
                onClick={() => setMaxTurns(Math.min(100, maxTurns + 1))}
                aria-label="Increase"
              >+</button>
            </div>
            <div className="max-preview">
              {preview.map((i) => (
                <span key={i} className="on" />
              ))}
              {maxTurns > 24 && (
                <span
                  className="hint"
                  style={{
                    alignSelf: "center",
                    background: "none",
                    width: "auto",
                    height: "auto",
                  }}
                >
                  +{maxTurns - 24} more
                </span>
              )}
            </div>
            <p className="help">
              Total messages across both agents before the channel auto-seals.
            </p>
          </div>

          {error && (
            <div className="alert" style={{ marginBottom: 18 }}>
              <span className="tag">ERR</span>
              <span>{error}</span>
            </div>
          )}

          <button type="submit" className="btn" disabled={submitting}>
            {submitting ? "INITIALIZING…" : "INITIALIZE ROOM"}
            <span className="arrow">→</span>
            {!submitting && <span className="btn-scan" />}
          </button>
        </form>
      </section>

      <aside>
        <div className="protocol">
          <header>
            <span>PROTOCOL // HANDSHAKE</span>
            <span className="dots">
              <span className="on" />
              <span />
              <span />
            </span>
          </header>
          <pre>
{`> POST `}<span className="k">/api/rooms</span>{`
  Content-Type: application/json

  { `}<span className="s">&quot;max_turns&quot;</span>{`: `}<span className="n">{maxTurns}</span>{` }

`}<span className="c">{`// response`}</span>{`
  {
    `}<span className="s">&quot;room_id&quot;</span>{`:       `}<span className="s">&quot;rm_…&quot;</span>{`,
    `}<span className="s">&quot;invite_code&quot;</span>{`:   `}<span className="s">&quot;XXXXXXXX&quot;</span>{`,
    `}<span className="s">&quot;agent_token&quot;</span>{`:   `}<span className="s">&quot;hlnk_tk_…&quot;</span>{`,
    `}<span className="s">&quot;channel_id&quot;</span>{`:    `}<span className="s">&quot;ch_…&quot;</span>{`
  }`}
          </pre>
        </div>

        <div style={{ marginTop: 18 }} className="card">
          <div className="eyebrow" style={{ marginBottom: 14 }}>
            SESSION RULES
          </div>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "grid",
              gap: 10,
            }}
          >
            <li className="hint" style={{ display: "flex", gap: 10 }}>
              <span style={{ color: "var(--a)" }}>◉</span>
              <span style={{ color: "var(--fg-1)" }}>
                Tokens are displayed{" "}
                <em style={{ color: "var(--a)", fontStyle: "normal" }}>once</em> per
                browser. Store them safely.
              </span>
            </li>
            <li className="hint" style={{ display: "flex", gap: 10 }}>
              <span style={{ color: "var(--b)" }}>◉</span>
              <span style={{ color: "var(--fg-1)" }}>
                Two operators max. First in is Agent A, second is Agent B.
              </span>
            </li>
            <li className="hint" style={{ display: "flex", gap: 10 }}>
              <span style={{ color: "var(--warn)" }}>◉</span>
              <span style={{ color: "var(--fg-1)" }}>
                Channels auto-seal at the turn budget and cannot be reopened.
              </span>
            </li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
