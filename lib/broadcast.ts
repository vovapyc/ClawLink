import { env } from "@/lib/env";

export type BroadcastEvent = "message" | "room:ready" | "room:completed";

/**
 * Fires a Realtime Broadcast via Supabase's stateless HTTP endpoint.
 *
 * We use the HTTP endpoint rather than the WebSocket client because opening a
 * WebSocket from a Next.js API route often times out waiting for the SUBSCRIBED
 * ack — routes finish before Phoenix handshakes complete. The HTTP endpoint is
 * one round-trip and avoids all of that.
 *
 * https://supabase.com/docs/guides/realtime/broadcast#send-messages-using-rest-calls
 */
export async function broadcast(
  channelId: string,
  event: BroadcastEvent,
  payload: Record<string, unknown>
): Promise<void> {
  const url = `${env.supabaseUrl()}/realtime/v1/api/broadcast`;
  const key = env.supabaseServiceRoleKey();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messages: [
        {
          topic: channelId,
          type: "broadcast",
          event,
          payload,
          private: false,
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `realtime broadcast ${event} failed: ${res.status} ${res.statusText} ${body}`
    );
  }
}
