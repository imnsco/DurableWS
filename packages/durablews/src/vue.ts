/**
 * Vue bindings for durablews — `import { useWebSocket } from "durablews/vue"`.
 *
 * Requires Vue 3 (an optional peer dependency: installing durablews without
 * Vue never warns; this module only loads when imported).
 */
import {
    type ComputedRef,
    computed,
    getCurrentScope,
    onScopeDispose,
    type ShallowRef,
    shallowRef
} from "vue";
import {
    canConnect,
    resolveSource,
    type UseWebSocketSource
} from "@/helpers/binding";
import type { StandardSchemaV1 } from "@/schema";
import type {
    ConnectionState,
    WebSocketClient,
    WebSocketClientConfig
} from "@/types";

/**
 * What {@link useWebSocket} returns: the client itself plus reactive views of
 * its observable state.
 */
export interface UseWebSocketReturn<TIn = unknown, TOut = unknown> {
    /** The underlying client, for everything beyond the reactive surface. */
    readonly client: WebSocketClient<TIn, TOut>;
    /** The connection state, as a reactive ref. */
    readonly state: ComputedRef<ConnectionState>;
    /** The most recent failure, if any. */
    readonly lastError: ComputedRef<Event | Error | null>;
    /** Retries used in the current disconnection episode. */
    readonly retryAttempt: ComputedRef<number>;
    /** Messages currently waiting in the outbound queue. */
    readonly queueLength: ComputedRef<number>;
    /**
     * The most recent inbound message (decoded and, if a schema is configured,
     * validated). `undefined` until the first message arrives. Only the latest
     * message is retained — handle the `message` event on {@link client} to
     * process every message.
     */
    readonly lastMessage: Readonly<ShallowRef<TIn | undefined>>;
    /** Sends data (queueing while disconnected, per the client's config). */
    readonly send: (data: TOut) => void;
    /** Opens the connection. See `WebSocketClient.connect`. */
    readonly connect: () => Promise<void>;
    /** Closes the connection. */
    readonly close: (code?: number, reason?: string) => void;
}

/**
 * A composable exposing a durablews client as reactive state.
 *
 * Pass a **config** and the composable owns the client: it connects
 * immediately (skipped during SSR — the browser run connects) and closes the
 * connection when the component's scope is disposed. Pass an **existing
 * client** (e.g. an app-wide singleton shared by many components) and the
 * composable only observes it — it never connects or closes a client it was
 * handed.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { useWebSocket } from "durablews/vue";
 *
 * const { state, lastMessage, send } = useWebSocket({
 *     url: "wss://example.com/socket"
 * });
 * </script>
 *
 * <template>
 *     <p>{{ state }} — last: {{ lastMessage }}</p>
 *     <button @click="send({ type: 'hello' })">Say hello</button>
 * </template>
 * ```
 */
export function useWebSocket<TSchema extends StandardSchemaV1>(
    source: WebSocketClientConfig & { readonly schema: TSchema }
): UseWebSocketReturn<StandardSchemaV1.InferOutput<TSchema>>;
export function useWebSocket<TIn = unknown, TOut = unknown>(
    source: UseWebSocketSource<TIn, TOut>
): UseWebSocketReturn<TIn, TOut>;
export function useWebSocket(source: UseWebSocketSource): UseWebSocketReturn {
    const { client: ws, owned } = resolveSource(source);

    const snapshot = shallowRef(ws.getState());
    const stopSnapshot = ws.subscribe(() => {
        snapshot.value = ws.getState();
    });
    const lastMessage = shallowRef<unknown>(undefined);
    const offMessage = ws.on("message", (msg) => {
        lastMessage.value = msg;
    });

    if (owned && canConnect()) {
        // Terminal failures surface via the `error`/`close` events; swallow
        // the rejection so fire-and-forget auto-connect never goes unhandled.
        ws.connect().catch(() => {});
    }

    if (getCurrentScope()) {
        onScopeDispose(() => {
            stopSnapshot();
            offMessage();
            if (owned) {
                ws.close();
            }
        });
    }

    return {
        client: ws,
        state: computed(() => snapshot.value.state),
        lastError: computed(() => snapshot.value.lastError),
        retryAttempt: computed(() => snapshot.value.retryAttempt),
        queueLength: computed(() => snapshot.value.queueLength),
        lastMessage,
        send: ws.send,
        connect: ws.connect,
        close: ws.close
    };
}

export type { UseWebSocketSource } from "@/helpers/binding";
