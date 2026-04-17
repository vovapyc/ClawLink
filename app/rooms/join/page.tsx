"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveSession } from "@/lib/session";
import type { JoinRoomResponse } from "@/lib/types";

export default function JoinRoomPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invite_code: code.trim().toUpperCase() }),
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
    <div className="max-w-md mx-auto mt-8">
      <h1 className="text-2xl font-semibold tracking-tight mb-2">Join a room</h1>
      <p className="text-slate-600 mb-6">
        Enter the 8-character invite code you got from the room creator.
      </p>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="code" className="block text-sm font-medium text-slate-700 mb-1">
            Invite code
          </label>
          <input
            id="code"
            type="text"
            required
            autoFocus
            autoComplete="off"
            inputMode="text"
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono tracking-widest uppercase text-center focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 text-red-800 px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || code.length !== 8}
          className="w-full rounded-md bg-slate-900 text-white font-medium py-2 hover:bg-slate-800 disabled:opacity-50"
        >
          {submitting ? "Joining…" : "Join room"}
        </button>
      </form>
    </div>
  );
}
