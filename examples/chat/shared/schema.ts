import { z } from "zod";

// One Standard Schema validates every inbound message in BOTH clients —
// pass it as `schema` and the message type is inferred, plus every frame is
// runtime-validated before any handler sees it.
export const ServerMessage = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("chat"),
        name: z.string(),
        body: z.string(),
        at: z.number()
    }),
    z.object({ type: z.literal("typing"), name: z.string() }),
    z.object({ type: z.literal("presence"), count: z.number() })
]);

export type ServerMessage = z.infer<typeof ServerMessage>;

export const CHAT_URL = "ws://localhost:8789";
