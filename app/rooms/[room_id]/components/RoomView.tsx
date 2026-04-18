"use client";

import { useEffect, useMemo, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { loadSession } from "@/lib/session";
import type {
  LocalAgentSession,
  Message,
  RoomStateResponse,
  RoomStatus,
} from "@/lib/types";
import AgentConnectionInfo from "./AgentConnectionInfo";
import ChatFeed from "./ChatFeed";
import RoomStatusBadge from "./RoomStatusBadge";
import TurnCounter from "./TurnCounter";

export default function RoomView({
  initialState,
}: {
  initialState: RoomStateResponse;
}) {
  const [status, setStatus] = useState<RoomStatus>(initialState.status);
  const [currentTurns, setCurrentTurns] = useState(initialState.current_turns);
  const [messages, setMessages] = useState<Message[]>(initialState.messages);
  const [session, setSession] = useState<LocalAgentSession | null>(null);

  useEffect(() => {
    setSession(loadSession(initialState.room_id));
  }, [initialState.room_id]);

  const channelId = initialState.room_channel_id;

  useEffect(() => {
    const client = getBrowserClient();
    const channel = client.channel(channelId);

    channel
      .on("broadcast", { event: "message" }, (payload) => {
        const msg = payload.payload as Message;
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          const next = [...prev, msg];
          next.sort((a, b) => a.turn_index - b.turn_index);
          return next;
        });
        setCurrentTurns((prev) => Math.max(prev, msg.turn_index));
      })
      .on("broadcast", { event: "room:ready" }, () => {
        setStatus("active");
      })
      .on("broadcast", { event: "room:completed" }, () => {
        setStatus("completed");
      })
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [channelId]);

  // Poll on mount, then keep polling every 2s while status is 'waiting'.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll(): Promise<void> {
      try {
        const res = await fetch(`/api/rooms/${initialState.room_id}`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as RoomStateResponse;
        if (cancelled) return;
        setStatus(data.status);
        setCurrentTurns(data.current_turns);
        setMessages(data.messages);
        if (data.status === "waiting") {
          timer = setTimeout(poll, 2000);
        }
      } catch {
        if (!cancelled) timer = setTimeout(poll, 2000);
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [initialState.room_id]);

  const apiBaseUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.origin;
  }, []);

  const pct = Math.round((currentTurns / initialState.max_turns) * 100);

  return (
    <>
      <div className="room-header">
        <div>
          <div className="eyebrow">
            <span className="chip">03 / LIVE</span>
            DUAL-AGENT OBSERVATORY
          </div>
          <h1 className="display" style={{ fontSize: 34, marginTop: 6 }}>
            Channel open.
          </h1>
          <div className="room-id">
            <span className="hash">#</span> {initialState.room_id}{" "}
            <span style={{ color: "var(--fg-3)" }}>·</span> channel{" "}
            <span className="hash">@</span>
            {channelId}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          <TurnCounter current={currentTurns} max={initialState.max_turns} />
          <div className="metric">
            <span className="k">BUDGET</span>
            <span className="v">{pct}%</span>
          </div>
          <RoomStatusBadge status={status} />
        </div>
      </div>

      <AgentConnectionInfo
        session={session}
        roomChannelId={channelId}
        apiBaseUrl={apiBaseUrl}
        status={status}
        inviteCode={session?.invite_code}
      />

      <ChatFeed messages={messages} myLabel={session?.user_label ?? null} />

      {status === "completed" && (
        <div className="banner-complete">
          ▶ TRANSMISSION SEALED · {currentTurns}{" "}
          <span className="pct">/ {initialState.max_turns}</span> TURNS LOGGED ·
          EXPORT AVAILABLE VIA API
        </div>
      )}
    </>
  );
}
