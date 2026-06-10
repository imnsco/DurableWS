import { computeDelay, resolveReconnect } from "@/backoff";
import { jsonCodec } from "@/codec";
import { nextState } from "@/fsm";
import { defineEventBus } from "@/helpers/event-bus";
import { runPipeline } from "@/pipeline";
import { resolveQueue } from "@/queue";
import type {
    ClientEventMap,
    ClientState,
    ConnectionEvent,
    ConnectionState,
    Middleware,
    WebSocketClient,
    WebSocketClientConfig
} from "@/types";

/**
 * Creates a WebSocket client driven by an explicit connection FSM.
 *
 * Durable by default: an unexpected disconnect schedules a reconnect with
 * full-jitter exponential backoff (see `backoff.ts`); pass `reconnect: false`
 * to opt out.
 *
 * @param config - Connection configuration (at minimum, a `url`).
 *
 * @example
 * ```typescript
 * const ws = client({ url: "wss://example.com/socket" });
 *
 * ws.on("message", (data) => console.log("received:", data));
 * ws.on("reconnecting", ({ attempt, delay }) => {
 *     console.log(`retry #${attempt} in ${Math.round(delay)}ms`);
 * });
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
    const reconnect = resolveReconnect(config.reconnect);
    const queue = resolveQueue(config.queue);
    const middlewares: Middleware[] = [];

    // Outbound messages awaiting an open socket, in send() order. Original
    // (un-encoded) values: encoding happens at flush, so a drop event can hand
    // the user back exactly what they passed to send().
    const queued: unknown[] = [];

    let socket: WebSocket | null = null;
    let state: ConnectionState = "idle";
    let lastError: Event | null = null;

    // True between a user close() and the next connect(); suppresses
    // reconnection so "the user hung up" is never retried.
    let closeRequested = false;
    // Retries used in the current disconnection episode (see ClientState).
    let retryAttempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    // The in-flight connect() promise and its settlers. A single promise is
    // shared across concurrent/repeat connect() calls so the method is
    // idempotent, and it survives failed attempts while reconnection is
    // active — it settles only on first open or terminal failure.
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
        if (next === null || next === state) {
            return null;
        }

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

    function clearRetryTimer() {
        if (retryTimer !== null) {
            clearTimeout(retryTimer);
            retryTimer = null;
        }
    }

    /**
     * Sends every queued message in order. Called once the socket opens,
     * *before* the `open` event, so the backlog (sent earlier in time)
     * precedes anything an `open` handler sends. A per-message encode/send
     * failure surfaces as an `error` event and flushing continues.
     */
    function flushQueue() {
        while (queued.length > 0 && socket && state === "open") {
            const data = queued.shift();
            try {
                socket.send(codec.encode(data));
            } catch (error) {
                bus.emit("error", toError(error));
            }
        }
    }

    /**
     * Empties the queue as `drop` events — these messages will never be sent
     * (user `close()` or terminal failure). Never silently lossy.
     */
    function dropQueued() {
        while (queued.length > 0) {
            bus.emit("drop", { data: queued.shift(), reason: "close" });
        }
    }

    /**
     * Whether an unexpected close should be retried: reconnection enabled, not
     * a user `close()`, retries left, and no `shouldReconnect` veto.
     */
    function isRetryable(event: CloseEvent): boolean {
        return (
            reconnect !== null &&
            !closeRequested &&
            retryAttempt < reconnect.maxRetries &&
            reconnect.shouldReconnect(event)
        );
    }

    function openSocket() {
        lastError = null;
        socket = config.protocols
            ? new WebSocket(config.url, config.protocols)
            : new WebSocket(config.url);

        socket.onopen = () => {
            retryAttempt = 0;
            transition("OPEN");
            flushQueue();
            bus.emit("open");
            settleConnected();
        };

        socket.onmessage = (event: MessageEvent) => {
            deliver(event.data);
        };

        socket.onerror = (event: Event) => {
            lastError = event;
            bus.emit("error", event);
        };

        socket.onclose = (event: CloseEvent) => {
            const wasConnecting = state === "connecting";
            socket = null;

            if (reconnect !== null && isRetryable(event)) {
                // Event order is deliberate: statechange (state already moved
                // to `reconnecting`), then the close that caused it, then the
                // retry announcement with attempt + delay.
                retryAttempt += 1;
                const delay = computeDelay(retryAttempt - 1, reconnect);
                transition("RETRY");
                bus.emit("close", event);
                bus.emit("reconnecting", { attempt: retryAttempt, delay });
                retryTimer = setTimeout(() => {
                    retryTimer = null;
                    if (transition("CONNECT") !== null) {
                        openSocket();
                    }
                }, delay);
                return; // pending connect() survives the retry
            }

            transition("CLOSED");
            dropQueued();
            bus.emit("close", event);
            // Terminal for any in-flight connect(): closed before first open
            // with no (further) retries coming.
            if (wasConnecting || pending) {
                settleFailed(
                    new Error(
                        retryAttempt > 0
                            ? `WebSocket reconnect gave up after ${retryAttempt} attempt(s) (code ${event.code})`
                            : `WebSocket closed before opening (code ${event.code}${
                                  event.reason ? `: ${event.reason}` : ""
                              })`
                    )
                );
            }
        };
    }

    /**
     * Runs a decoded inbound message through the middleware chain. If the chain
     * completes, the message is emitted as `message`; a middleware that throws
     * or rejects surfaces as an `error`.
     */
    function deliver(raw: unknown) {
        const ctx = { data: codec.decode(raw), client: api };
        const emit = () => {
            bus.emit("message", ctx.data);
        };
        try {
            const result = runPipeline(middlewares, ctx, emit);
            if (result instanceof Promise) {
                result.catch((error: unknown) => {
                    bus.emit("error", toError(error));
                });
            }
        } catch (error) {
            bus.emit("error", toError(error));
        }
    }

    /** Lazily create (or reuse) the shared connect() promise. */
    function ensurePending(): Promise<void> {
        if (pending) {
            return pending.promise;
        }
        let resolve!: () => void;
        let reject!: (reason: Error) => void;
        const promise = new Promise<void>((res, rej) => {
            resolve = res;
            reject = rej;
        });
        pending = { promise, resolve, reject };
        return promise;
    }

    const api: WebSocketClient = {
        get state() {
            return state;
        },

        connect() {
            if (state === "open") {
                return Promise.resolve();
            }
            if (state === "connecting") {
                return ensurePending();
            }
            if (state === "closing") {
                return Promise.reject(
                    new Error(
                        "Cannot connect() while the connection is closing"
                    )
                );
            }
            if (state === "reconnecting") {
                // Skip the rest of the backoff wait and attempt now.
                clearRetryTimer();
                const promise = ensurePending();
                transition("CONNECT");
                openSocket();
                return promise;
            }

            // idle or closed → start a fresh episode.
            closeRequested = false;
            retryAttempt = 0;
            if (transition("CONNECT") === null) {
                return Promise.reject(
                    new Error(`Cannot connect() from state "${state}"`)
                );
            }

            const promise = ensurePending();
            try {
                openSocket();
            } catch (error) {
                transition("CLOSED");
                socket = null;
                settleFailed(toError(error));
            }

            return promise;
        },

        send(data: unknown) {
            if (socket && state === "open") {
                socket.send(codec.encode(data));
                return;
            }
            // An open is coming (or being retried): queue, bounded drop-oldest.
            if (
                queue !== null &&
                (state === "connecting" || state === "reconnecting")
            ) {
                if (queued.length >= queue.maxSize) {
                    bus.emit("drop", {
                        data: queued.shift(),
                        reason: "overflow"
                    });
                }
                queued.push(data);
                return;
            }
            throw new Error(
                `Cannot send: connection is not open (state: "${state}")`
            );
        },

        close(code?: number, reason?: string) {
            closeRequested = true;
            clearRetryTimer();
            retryAttempt = 0;
            // The user hung up: queued messages will never send. Surface them
            // now (deterministically), not when the socket finishes closing.
            dropQueued();

            if (state === "reconnecting") {
                // No socket exists while waiting out the backoff: go straight
                // to closed and terminate any in-flight connect().
                transition("CLOSE_REQUESTED");
                settleFailed(
                    new Error("close() called before the connection opened")
                );
                return;
            }
            if (!socket) {
                return;
            }
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

        use(middleware: Middleware) {
            middlewares.push(middleware);
            return api;
        },

        getState(): ClientState {
            return Object.freeze({
                state,
                lastError,
                retryAttempt,
                queueLength: queued.length
            });
        }
    };

    return api;
}

/** Normalize an unknown thrown value into an `Error`. */
function toError(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value));
}
