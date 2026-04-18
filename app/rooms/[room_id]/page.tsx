import { notFound } from "next/navigation";
import { getServiceClient } from "@/lib/supabase/server";
import type { Message, RoomStateResponse } from "@/lib/types";
import RoomView from "./components/RoomView";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RoomPage({
  params,
}: {
  params: { room_id: string };
}) {
  if (!UUID_RE.test(params.room_id)) notFound();

  const supabase = getServiceClient();
  const { data: room } = await supabase
    .from("rooms")
    .select(
      "id, room_channel_id, daily_max_turns, current_turns, turns_today, last_reset_date, status"
    )
    .eq("id", params.room_id)
    .maybeSingle();
  if (!room) notFound();

  const { data: messages } = await supabase
    .from("messages")
    .select("id, room_id, sender, content, turn_index, created_at")
    .eq("room_id", room.id)
    .order("turn_index", { ascending: true });

  const initialState: RoomStateResponse = {
    room_id: room.id,
    room_channel_id: room.room_channel_id,
    daily_max_turns: room.daily_max_turns,
    current_turns: room.current_turns,
    turns_today: room.turns_today,
    last_reset_date: room.last_reset_date,
    status: room.status,
    messages: (messages ?? []) as Message[],
  };

  return <RoomView initialState={initialState} />;
}
