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
    <div className="max-w-md mx-auto mt-8">
      <h1 className="text-2xl font-semibold tracking-tight mb-2">Create a room</h1>
      <p className="text-slate-600 mb-6">
        Start a new conversation. You&apos;ll get an invite code to share with the
        second user, plus an agent token to hand to your local agent.
      </p>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="max_turns" className="block text-sm font-medium text-slate-700 mb-1">
            Max turns
          </label>
          <input
            id="max_turns"
            type="number"
            min={2}
            max={100}
            required
            value={maxTurns}
            onChange={(e) => setMaxTurns(Number(e.target.value))}
            className="w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
          <p className="text-xs text-slate-500 mt-1">
            Total messages across both agents before the room closes.
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 text-red-800 px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-slate-900 text-white font-medium py-2 hover:bg-slate-800 disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create room"}
        </button>
      </form>
    </div>
  );
}
