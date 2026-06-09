import { jsonCodec } from "@/codec";
import { nextState } from "@/fsm";
import { defineEventBus } from "@/helpers/event-bus";
import type {
    ClientEventMap,
    ClientState,
    ConnectionEvent,
    ConnectionState,
    WebSocketClient,
    WebSocketClientConfig
} from "@/types";

/**
 * Creates a WebSocket client driven by an explicit connection FSM.
 *
 * @param config - Connection configuration (at minimum, a `url`).
 *
 * @example
 * ```typescript
 * const ws = client({ url: "wss://example.com/socket" });
 *
 * ws.on("message", (data) => console.log("received:", data));
 *
 * await ws.connect();
 * ws.send({ type: "hello", message: "world" });
 *
 * ws.close();
 * ```
 */
export function client(config: WebSocketClientConfig): WebSocketClient {
    const bus = defineEventBus();
    const codec = config.codec ?? jsonCodec;

    let socket: WebSocket | null = null;
    let state: ConnectionState = "idle";
    let lastError: Event | null = null;

    // The in-flight connect() promise and its settlers. A single promise is
    // shared across concurrent/repeat connect() calls so the method is
    // idempotent; it is cleared once the connection opens or terminally fails.
    let pending: {
        readonly promise: Promise<void>;
        readonly resolve: () => void;
        readonly reject: (reason: Error) => void;
    } | null = null;

    /**
     * Applies an FSM event. Legal transitions update the state and emit
     * `statechange`; illegal ones are ignored (the table is the guard).
     *
     * @returns the new state if a transition occurred, otherwise `null`.
     */
    function transition(event: ConnectionEvent): ConnectionState | null {
        const next = nextState(state, event);
        if (next === null || next === state) return null;

        const previous = state;
        state = next;
        bus.emit("statechange", { previous, current: next });
        return next;
    }

    function settleConnected() {
        pending?.resolve();
        pending = null;
    }

    function settleFailed(reason: Error) {
        pending?.reject(reason);
        pending = null;
    }

    function openSocket() {
        lastError = null;
        socket = config.protocols
            ? new WebSocket(config.url, config.protocols)
            : new WebSocket(config.url);

        socket.onopen = () => {
            transition("OPEN");
            bus.emit("open");
            settleConnected();
        };

        socket.onmessage = (event: MessageEvent) => {
            bus.emit("message", codec.decode(event.data));
        };

        socket.onerror = (event: Event) => {
            lastError = event;
            bus.emit("error", event);
        };

        socket.onclose = (event: CloseEvent) => {
            const wasConnecting = state === "connecting";
            transition("CLOSED");
            socket = null;
            bus.emit("close", event);
            // A socket that closes before it ever opened is a terminal failure
            // for this connect() call (reconnection lands in M3).
            if (wasConnecting) {
                settleFailed(
                    new Error(
                        `WebSocket closed before opening (code ${event.code}${
                            event.reason ? `: ${event.reason}` : ""
                        })`
                    )
                );
            }
        };
    }

    return {
        get state() {
            return state;
        },

        connect() {
            if (state === "open") return Promise.resolve();
            if (state === "connecting" && pending) return pending.promise;
            if (state === "closing") {
                return Promise.reject(
                    new Error(
                        "Cannot connect() while the connection is closing"
                    )
                );
            }

            // idle or closed → start a fresh attempt.
            if (transition("CONNECT") === null) {
                return Promise.reject(
                    new Error(`Cannot connect() from state "${state}"`)
                );
            }

            let resolve!: () => void;
            let reject!: (reason: Error) => void;
            const promise = new Promise<void>((res, rej) => {
                resolve = res;
                reject = rej;
            });
            pending = { promise, resolve, reject };

            try {
                openSocket();
            } catch (error) {
                transition("CLOSED");
                socket = null;
                const reason =
                    error instanceof Error ? error : new Error(String(error));
                settleFailed(reason);
            }

            return promise;
        },

        send(data: unknown) {
            if (!socket || state !== "open") {
                throw new Error(
                    `Cannot send: connection is not open (state: "${state}")`
                );
            }
            socket.send(codec.encode(data));
        },

        close(code?: number, reason?: string) {
            if (!socket) return;
            transition("CLOSE_REQUESTED");
            socket.close(code, reason);
        },

        on<K extends keyof ClientEventMap>(
            event: K,
            handler: (payload: ClientEventMap[K]) => void
        ) {
            bus.on(event, handler);
            return () => bus.off(event, handler);
        },

        getState(): ClientState {
            return Object.freeze({ state, lastError });
        }
    };
}
