import { client } from "@/client";
import type { StandardSchemaV1 } from "@/schema";
import type { WebSocketClient, WebSocketClientConfig } from "@/types";

/**
 * Creates a new {@link WebSocketClient}.
 *
 * Each call returns an independent client — there is no shared singleton.
 *
 * Inbound message typing, three ways:
 * - **Schema (recommended):** pass a [Standard Schema](https://standardschema.dev)
 *   (zod, valibot, arktype, …) and the message type is inferred — plus every
 *   inbound message is validated at runtime.
 * - **Generics:** `defineClient<Incoming, Outgoing>(config)` for types without
 *   runtime validation.
 * - **Neither:** messages are `unknown`.
 *
 * @example
 * ```typescript
 * const Message = z.object({ type: z.string(), body: z.string() });
 * const ws = defineClient({ url: "wss://example.com/socket", schema: Message });
 *
 * ws.on("message", (msg) => {
 *     // msg is { type: string; body: string } — validated at runtime
 * });
 * await ws.connect();
 * ```
 */
export function defineClient<TSchema extends StandardSchemaV1>(
    config: WebSocketClientConfig & { readonly schema: TSchema }
): WebSocketClient<StandardSchemaV1.InferOutput<TSchema>>;
export function defineClient<TIn = unknown, TOut = unknown>(
    config: WebSocketClientConfig
): WebSocketClient<TIn, TOut>;
export function defineClient(config: WebSocketClientConfig): WebSocketClient {
    return client(config);
}

export { RECONNECT_DEFAULTS } from "@/backoff";
export { jsonCodec } from "@/codec";
export { HEARTBEAT_TIMEOUT_CODE } from "@/heartbeat";
export { pingpong } from "@/middleware/pingpong";
export { QUEUE_DEFAULTS } from "@/queue";
export type { StandardSchemaV1 } from "@/schema";
export { SchemaValidationError } from "@/schema";
export type {
    ClientEventMap,
    ClientState,
    Codec,
    ConnectionState,
    DirectionalMiddleware,
    DropEvent,
    HeartbeatOptions,
    MessageContext,
    Middleware,
    OutboundContext,
    OutboundMiddleware,
    QueueOptions,
    ReconnectingEvent,
    ReconnectOptions,
    StateChange,
    WebSocketClient,
    WebSocketClientConfig
} from "@/types";
