/**
 * React bindings for durablews — `import { useWebSocket } from "durablews/react"`.
 *
 * Requires React 18+ (an optional peer dependency: installing durablews
 * without React never warns; this module only loads when imported).
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { resolveSource, type UseWebSocketSource } from "@/helpers/binding";
import type { StandardSchemaV1 } from "@/schema";
import type {
    ConnectionState,
    WebSocketClient,
    WebSocketClientConfig
} from "@/types";

/**
 * What {@link useWebSocket} returns: the client itself plus its observable
 * state as plain render-ready values.
 */
export interface UseWebSocketReturn<TIn = unknown, TOut = unknown> {
    /** The underlying client, for everything beyond the hook's surface. */
    readonly client: WebSocketClient<TIn, TOut>;
    /** The connection state. */
    readonly state: ConnectionState;
    /** The most recent failure, if any. */
    readonly lastError: Event | Error | null;
    /** Retries used in the current disconnection episode. */
    readonly retryAttempt: number;
    /** Messages currently waiting in the outbound queue. */
    readonly queueLength: number;
    /**
     * The most recent inbound message (decoded and, if a schema is configured,
     * validated). `undefined` until the first message arrives. Only the latest
     * message is retained — handle the `message` event on {@link client} to
     * process every message.
     */
    readonly lastMessage: TIn | undefined;
    /** Sends data (queueing while disconnected, per the client's config). */
    readonly send: (data: TOut) => void;
    /** Opens the connection. See `WebSocketClient.connect`. */
    readonly connect: () => Promise<void>;
    /** Closes the connection. */
    readonly close: (code?: number, reason?: string) => void;
}

/**
 * A hook exposing a durablews client as React state, built on
 * `useSyncExternalStore` (the client's `subscribe`/`getState` pair is exactly
 * that contract, with referentially stable snapshots).
 *
 * Pass a **config** and the hook owns the client: it connects in an effect
 * (SSR-safe — effects don't run on the server) and closes the connection on
 * unmount. The config is captured on first render; changing it later does not
 * recreate the client. Pass an **existing client** (e.g. an app-wide singleton
 * shared by many components) and the hook only observes it — it never connects
 * or closes a client it was handed.
 *
 * @example
 * ```tsx
 * import { useWebSocket } from "durablews/react";
 *
 * function Status() {
 *     const { state, lastMessage, send } = useWebSocket({
 *         url: "wss://example.com/socket"
 *     });
 *     return (
 *         <button onClick={() => send({ type: "hello" })}>
 *             {state} — last: {JSON.stringify(lastMessage)}
 *         </button>
 *     );
 * }
 * ```
 */
export function useWebSocket<TSchema extends StandardSchemaV1>(
    source: WebSocketClientConfig & { readonly schema: TSchema }
): UseWebSocketReturn<StandardSchemaV1.InferOutput<TSchema>>;
export function useWebSocket<TIn = unknown, TOut = unknown>(
    source: UseWebSocketSource<TIn, TOut>
): UseWebSocketReturn<TIn, TOut>;
export function useWebSocket(source: UseWebSocketSource): UseWebSocketReturn {
    // Resolve exactly once per hook instance (state initializers run only on
    // first render), so re-renders never spawn extra clients.
    const [{ client: ws, owned }] = useState(() => resolveSource(source));

    const snapshot = useSyncExternalStore(
        ws.subscribe,
        ws.getState,
        ws.getState
    );

    const [lastMessage, setLastMessage] = useState<unknown>(undefined);
    useEffect(
        // The updater form guards against function-valued messages, which
        // setState would otherwise invoke instead of store.
        () => ws.on("message", (msg) => setLastMessage(() => msg)),
        [ws]
    );

    useEffect(() => {
        if (!owned) {
            return;
        }
        // Terminal failures surface via the `error`/`close` events; swallow
        // the rejection so fire-and-forget auto-connect never goes unhandled.
        ws.connect().catch(() => {});
        // Strict Mode runs this effect twice: close() then connect() again is
        // a legal closed → fresh-episode sequence, so the double-run is safe.
        return () => ws.close();
    }, [ws, owned]);

    return {
        client: ws,
        state: snapshot.state,
        lastError: snapshot.lastError,
        retryAttempt: snapshot.retryAttempt,
        queueLength: snapshot.queueLength,
        lastMessage,
        send: ws.send,
        connect: ws.connect,
        close: ws.close
    };
}

export type { UseWebSocketSource } from "@/helpers/binding";
