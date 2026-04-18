import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/server";
import { hashToken } from "@/lib/tokens";
import { postMessageSchema } from "@/lib/validation";
import { bearerToken, errorResponse, readJson, zodErrorResponse } from "@/lib/api";
import { broadcast } from "@/lib/broadcast";
import type { Message, PostMessageResponse, RoomStatus, UserLabel } from "@/lib/types";

export const runtime = "nodejs";

function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function nextUtcMidnightIso(): string {
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
  return next.toISOString();
}

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) return errorResponse(401, "missing_token");

  const body = await readJson<unknown>(req);
  if (body === null) return errorResponse(400, "invalid_json");

  let input: z.infer<typeof postMessageSchema>;
  try {
    input = postMessageSchema.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError) return zodErrorResponse(err);
    throw err;
  }

  const supabase = getServiceClient();

  // 1. Look up participant by token hash
  const tokenHash = hashToken(token);
  const { data: participant, error: partErr } = await supabase
    .from("room_participants")
    .select("room_id, user_label")
    .eq("agent_token_hash", tokenHash)
    .maybeSingle();
  if (partErr) {
    console.error("messages: participant lookup error", partErr);
    return errorResponse(500, "db_error", partErr.message);
  }
  if (!participant) return errorResponse(401, "invalid_token");

  const sender = participant.user_label as UserLabel;

  // 2. Load room state
  const { data: room, error: roomErr } = await supabase
    .from("rooms")
    .select(
      "id, room_channel_id, daily_max_turns, current_turns, turns_today, last_reset_date, status"
    )
    .eq("id", participant.room_id)
    .single();
  if (roomErr) {
    console.error("messages: room lookup error", roomErr);
    return errorResponse(500, "db_error", roomErr.message);
  }
  if (room.status !== "active") {
    return errorResponse(409, "room_not_active", `room status is ${room.status}`);
  }

  // 3. Daily quota check (pre-RPC, to return a clean 429 vs. 409-race).
  const today = todayUtcIso();
  if (
    room.last_reset_date === today &&
    room.turns_today >= room.daily_max_turns
  ) {
    return NextResponse.json(
      {
        error: "daily_quota_reached",
        message: `daily quota of ${room.daily_max_turns} reached`,
        next_reset_at: nextUtcMidnightIso(),
      },
      { status: 429 }
    );
  }

  // 4. Enforce turn order: even current_turns → agent_a's turn, odd → agent_b's
  const expected: UserLabel = room.current_turns % 2 === 0 ? "agent_a" : "agent_b";
  if (sender !== expected) {
    return errorResponse(403, "not_your_turn");
  }

  // 5. Atomically advance the turn counter (lazy daily reset inside the RPC)
  const { data: advancedRows, error: advErr } = await supabase.rpc(
    "advance_room_turn",
    { p_room_id: room.id }
  );
  if (advErr) {
    console.error("messages: advance_room_turn error", advErr);
    return errorResponse(500, "db_error", advErr.message);
  }
  const advanced = (advancedRows as Array<{
    current_turns: number;
    turns_today: number;
    daily_max_turns: number;
    last_reset_date: string;
    status: RoomStatus;
  }> | null)?.[0];
  if (!advanced) {
    return errorResponse(409, "turn_already_advanced");
  }

  const newTurnIndex = advanced.current_turns;
  const newStatus = advanced.status;

  // 6. Insert the message row
  const { data: inserted, error: insErr } = await supabase
    .from("messages")
    .insert({
      room_id: room.id,
      sender,
      content: input.content,
      turn_index: newTurnIndex,
    })
    .select("id, room_id, sender, content, turn_index, created_at")
    .single();

  if (insErr) {
    console.error("messages: insert error", insErr);
    return errorResponse(500, "db_error", insErr.message);
  }

  const message = inserted as Message;

  // 7. Broadcast. Include quota state so clients can update without refetch.
  try {
    await broadcast(room.room_channel_id, "message", {
      ...message,
      turns_today: advanced.turns_today,
      daily_max_turns: advanced.daily_max_turns,
      last_reset_date: advanced.last_reset_date,
    });
  } catch (err) {
    console.error("messages: broadcast message failed", err);
  }

  const response: PostMessageResponse = {
    message_id: message.id,
    turn_index: newTurnIndex,
    current_turns: newTurnIndex,
    turns_today: advanced.turns_today,
    last_reset_date: advanced.last_reset_date,
    status: newStatus,
  };
  return NextResponse.json(response, { status: 201 });
}
