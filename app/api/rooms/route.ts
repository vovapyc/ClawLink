import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/server";
import {
  generateAgentToken,
  generateChannelId,
  generateInviteCode,
  hashToken,
} from "@/lib/tokens";
import { createRoomSchema } from "@/lib/validation";
import { errorResponse, readJson, zodErrorResponse } from "@/lib/api";
import type { CreateRoomResponse } from "@/lib/types";

export const runtime = "nodejs";

const MAX_INVITE_ATTEMPTS = 5;

export async function POST(req: Request) {
  const body = await readJson<unknown>(req);
  if (body === null) return errorResponse(400, "invalid_json");

  let input: z.infer<typeof createRoomSchema>;
  try {
    input = createRoomSchema.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError) return zodErrorResponse(err);
    throw err;
  }

  const supabase = getServiceClient();
  const channelId = generateChannelId();
  const agentToken = generateAgentToken();
  const tokenHash = hashToken(agentToken);

  // Retry a few times in the unlikely event of an invite_code collision.
  for (let attempt = 0; attempt < MAX_INVITE_ATTEMPTS; attempt++) {
    const inviteCode = generateInviteCode();

    const { data: room, error: roomErr } = await supabase
      .from("rooms")
      .insert({
        invite_code: inviteCode,
        room_channel_id: channelId,
        daily_max_turns: input.daily_max_turns,
      })
      .select()
      .single();

    if (roomErr) {
      const code = (roomErr as { code?: string }).code;
      if (code === "23505") continue; // unique_violation on invite_code
      console.error("create_room error", roomErr);
      return errorResponse(500, "db_error", roomErr.message);
    }

    const { error: participantErr } = await supabase
      .from("room_participants")
      .insert({
        room_id: room.id,
        user_label: "agent_a",
        agent_token_hash: tokenHash,
      });

    if (participantErr) {
      console.error("create_participant error", participantErr);
      // Best-effort cleanup — room row will dangle otherwise.
      await supabase.from("rooms").delete().eq("id", room.id);
      return errorResponse(500, "db_error", participantErr.message);
    }

    const payload: CreateRoomResponse = {
      room_id: room.id,
      invite_code: room.invite_code,
      room_channel_id: room.room_channel_id,
      user_label: "agent_a",
      agent_token: agentToken,
      daily_max_turns: room.daily_max_turns,
      turns_today: room.turns_today,
      last_reset_date: room.last_reset_date,
      status: room.status,
    };
    return NextResponse.json(payload, { status: 201 });
  }

  return errorResponse(500, "invite_code_exhausted");
}
