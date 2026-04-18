"use client";

import { useEffect, useRef } from "react";
import type { Message, UserLabel } from "@/lib/types";

const AGENT_LABEL: Record<UserLabel, string> = {
  agent_a: "AGENT-A / HX-9",
  agent_b: "AGENT-B / ARCHIVE",
};

function Waveform({ side }: { side: "left" | "right" }) {
  const accent = side === "left" ? "var(--a)" : "var(--b)";
  return (
    <svg className="wave" viewBox="0 0 200 20" preserveAspectRatio="none">
      <path
        d="M0,10 Q8,3 16,10 T32,10 Q40,16 48,10 T64,10 Q72,2 80,10 T96,10 Q104,17 112,10 T128,10 Q136,4 144,10 T160,10 Q168,15 176,10 T192,10 L200,10"
        fill="none"
        stroke={accent}
        strokeWidth="1.2"
        opacity="0.65"
      />
    </svg>
  );
}

function AgentHead({
  side,
  label,
  mine,
}: {
  side: "left" | "right";
  label: UserLabel;
  mine: boolean;
}) {
  return (
    <div className={`agent-head ${side}`}>
      <div className="name">
        <span className="led" />
        <span>{AGENT_LABEL[label]}</span>
        {mine && (
          <span style={{ color: "var(--fg-2)", fontSize: 9 }}>· YOU</span>
        )}
      </div>
      <div className="handle">
        {side === "left" ? "Primary channel" : "Secondary channel"}
      </div>
      <Waveform side={side} />
    </div>
  );
}

function EmptyFeed() {
  return (
    <div className="empty-feed">
      <div>
        <div className="radar"><div className="sweep" /></div>
        Scanning for inbound signal…
      </div>
    </div>
  );
}

function Bubble({
  msg,
  mine,
}: {
  msg: Message;
  mine: boolean;
}) {
  const isA = msg.sender === "agent_a";
  const sideClass = isA ? "left a" : "right b";
  const tag = isA ? "AGENT-A" : "AGENT-B";
  const ts = new Date(msg.created_at).toLocaleTimeString("en-GB", {
    hour12: false,
  });
  return (
    <div className={`bubble ${sideClass}`}>
      <span className="turn-tag">T{String(msg.turn_index).padStart(2, "0")}</span>
      <div className="meta">
        <span className="tag">{tag}</span>
        {mine && <span className="you">YOU</span>}
        <span style={{ color: "var(--fg-3)" }}>· {ts}</span>
      </div>
      <div className="body">{msg.content}</div>
    </div>
  );
}

export default function ChatFeed({
  messages,
  myLabel,
}: {
  messages: Message[];
  myLabel: UserLabel | null;
}) {
  const feedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  return (
    <section className="stage">
      <div className="stage-header">
        <AgentHead side="left" label="agent_a" mine={myLabel === "agent_a"} />
        <div className="vs">
          <div className="ring"><div className="dot" /></div>
          DUPLEX
        </div>
        <AgentHead side="right" label="agent_b" mine={myLabel === "agent_b"} />
      </div>

      <div className="feed" ref={feedRef}>
        {messages.length === 0 ? (
          <EmptyFeed />
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`msg ${m.sender === "agent_a" ? "from-a" : "from-b"}`}
            >
              <Bubble msg={m} mine={myLabel === m.sender} />
              <Bubble msg={m} mine={myLabel === m.sender} />
            </div>
          ))
        )}
      </div>
    </section>
  );
}
