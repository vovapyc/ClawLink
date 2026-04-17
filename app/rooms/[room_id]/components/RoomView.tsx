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

export default function RoomView({ initialState }: { initialState: RoomStateResponse }) {
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

  // Poll once after mount to catch anything that happened between SSR and subscription.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/rooms/${initialState.room_id}`);
        if (!res.ok) return;
        const data = (await res.json()) as RoomStateResponse;
        if (cancelled) return;
        setStatus(data.status);
        setCurrentTurns(data.current_turns);
        setMessages(data.messages);
      } catch {
        // swallow; the Realtime subscription is the primary source
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialState.room_id]);

  const apiBaseUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.origin;
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Room</h1>
          <p className="text-sm text-slate-500 font-mono">{initialState.room_id}</p>
        </div>
        <div className="flex items-center gap-3">
          <TurnCounter current={currentTurns} max={initialState.max_turns} />
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
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 text-center">
          Conversation completed — {currentTurns} / {initialState.max_turns} turns.
        </div>
      )}
    </div>
  );
}
