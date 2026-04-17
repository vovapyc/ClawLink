import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/server";
import { generateAgentToken, hashToken } from "@/lib/tokens";
import { joinRoomSchema } from "@/lib/validation";
import { errorResponse, readJson, zodErrorResponse } from "@/lib/api";
import { broadcast } from "@/lib/broadcast";
import type { JoinRoomResponse } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await readJson<unknown>(req);
  if (body === null) return errorResponse(400, "invalid_json");

  let input: z.infer<typeof joinRoomSchema>;
  try {
    input = joinRoomSchema.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError) return zodErrorResponse(err);
    throw err;
  }

  const supabase = getServiceClient();

  const { data: room, error: roomErr } = await supabase
    .from("rooms")
    .select("id, invite_code, room_channel_id, max_turns, current_turns, status")
    .eq("invite_code", input.invite_code)
    .maybeSingle();

  if (roomErr) {
    console.error("join_room lookup error", roomErr);
    return errorResponse(500, "db_error", roomErr.message);
  }
  if (!room) return errorResponse(404, "room_not_found");
  if (room.status === "completed") return errorResponse(410, "room_completed");

  // Count participants
  const { data: existing, error: countErr } = await supabase
    .from("room_participants")
    .select("user_label")
    .eq("room_id", room.id);
  if (countErr) {
    console.error("join_room count error", countErr);
    return errorResponse(500, "db_error", countErr.message);
  }

  if ((existing?.length ?? 0) >= 2) {
    return errorResponse(409, "room_full");
  }

  // Figure out which slot is open
  const taken = new Set((existing ?? []).map((p) => p.user_label));
  const openSlot = (["agent_a", "agent_b"] as const).find((s) => !taken.has(s));
  if (!openSlot) return errorResponse(409, "room_full");

  // In normal flow agent_a was created with the room, so B should join next.
  // But if agent_a is somehow missing we fill A first.
  const agentToken = generateAgentToken();
  const tokenHash = hashToken(agentToken);

  const { error: insertErr } = await supabase
    .from("room_participants")
    .insert({
      room_id: room.id,
      user_label: openSlot,
      agent_token_hash: tokenHash,
    });

  if (insertErr) {
    const code = (insertErr as { code?: string }).code;
    if (code === "23505") return errorResponse(409, "slot_taken");
    console.error("join_room insert error", insertErr);
    return errorResponse(500, "db_error", insertErr.message);
  }

  // Flip room to active if both seats are filled
  let status = room.status;
  if ((existing?.length ?? 0) + 1 >= 2) {
    const { data: updated, error: updateErr } = await supabase
      .from("rooms")
      .update({ status: "active" })
      .eq("id", room.id)
      .eq("status", "waiting")
      .select("status")
      .maybeSingle();
    if (updateErr) {
      console.error("join_room status update error", updateErr);
    }
    status = updated?.status ?? "active";

    try {
      await broadcast(room.room_channel_id, "room:ready", {
        room_channel_id: room.room_channel_id,
        max_turns: room.max_turns,
      });
    } catch (err) {
      console.error("room:ready broadcast failed", err);
      // Non-fatal — both clients also see status via GET /api/rooms/[id]
    }
  }

  const payload: JoinRoomResponse = {
    room_id: room.id,
    room_channel_id: room.room_channel_id,
    user_label: openSlot,
    agent_token: agentToken,
    max_turns: room.max_turns,
    current_turns: room.current_turns,
    status,
  };
  return NextResponse.json(payload);
}
