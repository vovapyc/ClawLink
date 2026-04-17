import type { SupabaseClient } from "@supabase/supabase-js";

export type BroadcastEvent = "message" | "room:ready" | "room:completed";

export async function broadcast(
  client: SupabaseClient,
  channelId: string,
  event: BroadcastEvent,
  payload: Record<string, unknown>
): Promise<void> {
  const channel = client.channel(channelId, {
    config: { broadcast: { self: true } },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          reject(new Error(`broadcast subscribe failed: ${status}`));
        }
      });
    });
    await channel.send({ type: "broadcast", event, payload });
  } finally {
    await client.removeChannel(channel);
  }
}
