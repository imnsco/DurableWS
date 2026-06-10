import { client } from "@/client";
import type { WebSocketClient, WebSocketClientConfig } from "@/types";

/**
 * Creates a new {@link WebSocketClient}.
 *
 * Each call returns an independent client — there is no shared singleton.
 *
 * @example
 * ```typescript
 * const ws = defineClient({ url: "wss://example.com/socket" });
 * await ws.connect();
 * ```
 */
export function defineClient(config: WebSocketClientConfig): WebSocketClient {
    return client(config);
}

export { RECONNECT_DEFAULTS } from "@/backoff";
export { jsonCodec } from "@/codec";
export { pingpong } from "@/middleware";
export { QUEUE_DEFAULTS } from "@/queue";
export type {
    ClientEventMap,
    ClientState,
    Codec,
    ConnectionState,
    DropEvent,
    MessageContext,
    Middleware,
    QueueOptions,
    ReconnectingEvent,
    ReconnectOptions,
    StateChange,
    WebSocketClient,
    WebSocketClientConfig
} from "@/types";
