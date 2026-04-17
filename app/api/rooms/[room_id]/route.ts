import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { errorResponse } from "@/lib/api";
import type { Message, RoomStateResponse } from "@/lib/types";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: Request,
  { params }: { params: { room_id: string } }
) {
  if (!UUID_RE.test(params.room_id)) {
    return errorResponse(400, "invalid_room_id");
  }

  const supabase = getServiceClient();

  const { data: room, error: roomErr } = await supabase
    .from("rooms")
    .select("id, room_channel_id, max_turns, current_turns, status")
    .eq("id", params.room_id)
    .maybeSingle();
  if (roomErr) {
    console.error("get_room error", roomErr);
    return errorResponse(500, "db_error", roomErr.message);
  }
  if (!room) return errorResponse(404, "room_not_found");

  const { data: messages, error: msgErr } = await supabase
    .from("messages")
    .select("id, room_id, sender, content, turn_index, created_at")
    .eq("room_id", room.id)
    .order("turn_index", { ascending: true });
  if (msgErr) {
    console.error("get_messages error", msgErr);
    return errorResponse(500, "db_error", msgErr.message);
  }

  const payload: RoomStateResponse = {
    room_id: room.id,
    room_channel_id: room.room_channel_id,
    max_turns: room.max_turns,
    current_turns: room.current_turns,
    status: room.status,
    messages: (messages ?? []) as Message[],
  };
  return NextResponse.json(payload);
}
