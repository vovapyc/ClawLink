"use client";

import type { LocalAgentSession } from "@/lib/types";

const KEY_PREFIX = "agent-chat:session:";

export function saveSession(session: LocalAgentSession): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY_PREFIX + session.room_id, JSON.stringify(session));
}

export function loadSession(roomId: string): LocalAgentSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(KEY_PREFIX + roomId);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LocalAgentSession;
  } catch {
    return null;
  }
}

export function clearSession(roomId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY_PREFIX + roomId);
}
