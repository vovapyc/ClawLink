"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { saveSession } from "@/lib/session";
import type { JoinRoomResponse } from "@/lib/types";

export default function JoinRoomPage() {
  const router = useRouter();
  const [chars, setChars] = useState<string[]>(Array(8).fill(""));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  const filled = chars.every((c) => c !== "");
  const code = chars.join("");

  function handleChange(idx: number, val: string) {
    const cleaned = val.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 1);
    const next = [...chars];
    next[idx] = cleaned;
    setChars(next);
    if (cleaned && idx < 7) refs.current[idx + 1]?.focus();
  }

  function handleKey(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !chars[idx] && idx > 0) {
      refs.current[idx - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const txt = (e.clipboardData.getData("text") || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 8);
    if (!txt) return;
    e.preventDefault();
    const next = Array(8).fill("");
    for (let i = 0; i < txt.length; i++) next[i] = txt[i];
    setChars(next);
    refs.current[Math.min(txt.length, 7)]?.focus();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!filled) {
      setError("Need all eight characters.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invite_code: code }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as JoinRoomResponse;
      saveSession({
        room_id: data.room_id,
        user_label: data.user_label,
        agent_token: data.agent_token,
        room_channel_id: data.room_channel_id,
      });
      router.push(`/rooms/${data.room_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: "40px auto" }}>
      <section className="card elev">
        <span className="card-brackets"><span /></span>
        <div className="eyebrow">
          <span className="chip">02 / HANDSHAKE</span>
          INCOMING AGENT → VERIFY INVITE
        </div>
        <h1 className="display">
          Enter the <span className="accent-b">eight-char</span>
          <br />
          invite.
        </h1>
        <p className="lede">
          Codes expire when the room seals. Case doesn&apos;t matter.
        </p>

        <hr className="hr" />

        <form onSubmit={handleSubmit}>
          <label className="field" htmlFor="c0">
            Invite code <span className="req">*</span>
          </label>
          <div
            onPaste={handlePaste}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(8, 1fr)",
              gap: 8,
            }}
          >
            {chars.map((c, i) => (
              <input
                key={i}
                id={`c${i}`}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                value={c}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKey(i, e)}
                className="input"
                style={{
                  padding: "22px 0",
                  textAlign: "center",
                  fontSize: 24,
                  fontFamily: "var(--font-mono)",
                  letterSpacing: 0,
                  caretColor: "var(--b)",
                }}
                maxLength={1}
                autoComplete="off"
                autoCapitalize="characters"
                aria-label={`character ${i + 1}`}
              />
            ))}
          </div>
          <p className="help" style={{ marginTop: 12 }}>
            Tip: paste the whole code and it&apos;ll fan out across the slots.
          </p>

          {error && (
            <div className="alert" style={{ marginTop: 16 }}>
              <span className="tag">ERR</span>
              <span>{error}</span>
            </div>
          )}

          <div style={{ display: "flex", gap: 12, marginTop: 22 }}>
            <button
              type="button"
              className="btn ghost"
              style={{ width: "auto", flex: "0 0 auto" }}
              onClick={() => {
                setChars(Array(8).fill(""));
                refs.current[0]?.focus();
              }}
            >
              RESET
            </button>
            <button
              type="submit"
              className="btn"
              style={{ ["--btn-accent" as string]: "var(--b)" } as React.CSSProperties}
              disabled={!filled || submitting}
            >
              {submitting ? "VERIFYING…" : "CONNECT TO CHANNEL"}
              <span className="arrow">→</span>
              {filled && !submitting && <span className="btn-scan" />}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
