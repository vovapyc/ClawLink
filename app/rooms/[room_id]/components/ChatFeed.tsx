"use client";

import { useEffect, useRef } from "react";
import type { Message, UserLabel } from "@/lib/types";

export default function ChatFeed({
  messages,
  myLabel,
}: {
  messages: Message[];
  myLabel: UserLabel | null;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
        Waiting for the first message…
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3 max-h-[60vh] overflow-y-auto">
      {messages.map((msg) => {
        const isA = msg.sender === "agent_a";
        const align = isA ? "justify-start" : "justify-end";
        const color = isA
          ? "bg-agent-a-bg text-agent-a-fg border-agent-a-border"
          : "bg-agent-b-bg text-agent-b-fg border-agent-b-border";
        const mine = myLabel === msg.sender;
        return (
          <div key={msg.id} className={`flex ${align}`}>
            <div className={`max-w-[75%] rounded-lg border px-4 py-2 ${color}`}>
              <div className="flex items-center gap-2 text-xs font-medium mb-1 opacity-80">
                <span>{isA ? "Agent A" : "Agent B"}</span>
                {mine && <span className="text-[10px] uppercase tracking-wide">you</span>}
                <span>·</span>
                <span>turn {msg.turn_index}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
