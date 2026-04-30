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

function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function nextUtcMidnightLocal(): string {
  const now = new Date();
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
      0
    )
  );
  return next.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

type MessageWithQuota = Message & {
  turns_today?: number;
  daily_max_turns?: number;
  last_reset_date?: string;
  sender_name?: string;
};

export default function RoomView({
  initialState,
  supabaseUrl,
  supabaseAnonKey,
}: {
  initialState: RoomStateResponse;
  supabaseUrl: string;
  supabaseAnonKey: string;
}) {
  const [status, setStatus] = useState<RoomStatus>(initialState.status);
  const [currentTurns, setCurrentTurns] = useState(initialState.current_turns);
  const [turnsToday, setTurnsToday] = useState(initialState.turns_today);
  const [dailyMaxTurns, setDailyMaxTurns] = useState(
    initialState.daily_max_turns
  );
  const [lastResetDate, setLastResetDate] = useState(
    initialState.last_reset_date
  );
  const [messages, setMessages] = useState<Message[]>(initialState.messages);
  const [agentAName, setAgentAName] = useState<string | undefined>(initialState.agent_a_name);
  const [agentBName, setAgentBName] = useState<string | undefined>(initialState.agent_b_name);
  const [session, setSession] = useState<LocalAgentSession | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setSession(loadSession(initialState.room_id));
  }, [initialState.room_id]);

  // Tick once a minute so the derived "today" value rolls over naturally at
  // UTC midnight without needing a broadcast.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const channelId = initialState.room_channel_id;

  useEffect(() => {
    const client = getBrowserClient();
    const channel = client.channel(channelId);

    channel
      .on("broadcast", { event: "message" }, (payload) => {
        const msg = payload.payload as MessageWithQuota;
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          const next = [...prev, msg];
          next.sort((a, b) => a.turn_index - b.turn_index);
          return next;
        });
        setCurrentTurns((prev) => Math.max(prev, msg.turn_index));
        if (typeof msg.turns_today === "number") setTurnsToday(msg.turns_today);
        if (typeof msg.daily_max_turns === "number")
          setDailyMaxTurns(msg.daily_max_turns);
        if (typeof msg.last_reset_date === "string")
          setLastResetDate(msg.last_reset_date);
        if (msg.sender_name) {
          if (msg.sender === "agent_a") setAgentAName(msg.sender_name);
          else setAgentBName(msg.sender_name);
        }
      })
      .on("broadcast", { event: "room:ready" }, (payload) => {
        const data = payload.payload as {
          agent_a_name?: string;
          agent_b_name?: string;
        };
        setStatus("active");
        if (data.agent_a_name) setAgentAName(data.agent_a_name);
        if (data.agent_b_name) setAgentBName(data.agent_b_name);
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
        setTurnsToday(data.turns_today);
        setDailyMaxTurns(data.daily_max_turns);
        setLastResetDate(data.last_reset_date);
        setMessages(data.messages);
        if (data.agent_a_name) setAgentAName(data.agent_a_name);
        if (data.agent_b_name) setAgentBName(data.agent_b_name);
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

  // `now` participates so this recomputes at the minute tick + UTC midnight.
  void now;
  const today = todayUtcIso();
  const effectiveTurnsToday = lastResetDate === today ? turnsToday : 0;
  const pct =
    dailyMaxTurns > 0
      ? Math.round((effectiveTurnsToday / dailyMaxTurns) * 100)
      : 0;
  const quotaReached = effectiveTurnsToday >= dailyMaxTurns;

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
          <TurnCounter today={effectiveTurnsToday} dailyMax={dailyMaxTurns} />
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
        supabaseUrl={supabaseUrl}
        supabaseAnonKey={supabaseAnonKey}
        status={status}
        inviteCode={session?.invite_code}
      />

      <ChatFeed
        messages={messages}
        myLabel={session?.user_label ?? null}
        names={{ agent_a: agentAName, agent_b: agentBName }}
      />

      {status === "active" && quotaReached && (
        <div className="banner-complete">
          ▶ DAILY QUOTA REACHED · {effectiveTurnsToday}
          <span className="pct"> / {dailyMaxTurns}</span> TURNS TODAY · RESUMES AT
          00:00 UTC ({nextUtcMidnightLocal()} LOCAL)
        </div>
      )}
    </>
  );
}
