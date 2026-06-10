import { computeDelay, resolveReconnect } from "@/backoff";
import { jsonCodec } from "@/codec";
import { nextState } from "@/fsm";
import { HEARTBEAT_TIMEOUT_CODE, resolveHeartbeat } from "@/heartbeat";
import { defineEventBus } from "@/helpers/event-bus";
import { runPipeline } from "@/pipeline";
import { resolveQueue } from "@/queue";
import { SchemaValidationError, type StandardSchemaV1 } from "@/schema";
import type {
    ClientEventMap,
    ClientState,
    ConnectionEvent,
    ConnectionState,
    DirectionalMiddleware,
    Middleware,
    OutboundMiddleware,
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
    const heartbeat = resolveHeartbeat(config.heartbeat);
    const middlewares: Middleware[] = [];
    const outboundMiddlewares: OutboundMiddleware[] = [];

    // Outbound messages awaiting an open socket, in send() order. Original
    // (un-encoded) values: encoding happens at flush, so a drop event can hand
    // the user back exactly what they passed to send().
    const queued: unknown[] = [];

    let socket: WebSocket | null = null;
    let state: ConnectionState = "idle";
    let lastError: Event | Error | null = null;

    // Heartbeat bookkeeping: when the last inbound frame (of any kind)
    // arrived, the ping interval, and the per-ping liveness deadline.
    let lastInboundAt = 0;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let heartbeatDeadline: ReturnType<typeof setTimeout> | null = null;

    // The serialized outbound path (in play only when outbound middleware is
    // registered). `outboundTail` is the tail of the in-flight chain: while
    // set, every new message chains behind it, so socket writes keep send()
    // order even when a middleware awaits. `requeueIndex` keeps messages that
    // were mid-pipeline when the connection dropped ahead of newer queued
    // sends; it resets on every socket close.
    let outboundTail: Promise<void> | null = null;
    let requeueIndex = 0;

    // True between a user close() and the next connect(); suppresses
    // reconnection so "the user hung up" is never retried.
    let closeRequested = false;
    // Retries used in the current disconnection episode (see ClientState).
    let retryAttempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    // subscribe() listeners plus the cached getState() snapshot. The cache
    // makes snapshots referentially stable between changes — required by
    // React's useSyncExternalStore (a fresh object per getSnapshot() call
    // would loop the renderer).
    const subscribers = new Set<() => void>();
    let snapshot: ClientState | null = null;

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
    /**
     * Invalidates the cached snapshot and fires subscribe() listeners. Called
     * after every mutation of the observable state, before the corresponding
     * bus event, so any observer reading getState() sees fresh data.
     */
    function notify() {
        snapshot = null;
        for (const listener of [...subscribers]) {
            listener();
        }
    }

    function transition(event: ConnectionEvent): ConnectionState | null {
        const next = nextState(state, event);
        if (next === null || next === state) {
            return null;
        }

        const previous = state;
        state = next;
        notify();
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

    function stopHeartbeat() {
        if (heartbeatTimer !== null) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
        if (heartbeatDeadline !== null) {
            clearTimeout(heartbeatDeadline);
            heartbeatDeadline = null;
        }
    }

    /**
     * While open, sends the heartbeat message every `interval` ms and arms a
     * liveness deadline after each ping. Any inbound frame before the deadline
     * proves the link; none means it's dead — force-close with code 4408,
     * which flows into the normal reconnect machinery (the close is not
     * user-initiated, so it is retryable).
     */
    function startHeartbeat() {
        if (heartbeat === null) {
            return;
        }
        stopHeartbeat();
        heartbeatTimer = setInterval(() => {
            if (state !== "open" || !socket) {
                return;
            }
            const pingSentAt = Date.now();
            try {
                socket.send(codec.encode(heartbeat.message));
            } catch (error) {
                bus.emit("error", toError(error));
            }
            if (heartbeatDeadline !== null) {
                clearTimeout(heartbeatDeadline);
            }
            heartbeatDeadline = setTimeout(() => {
                heartbeatDeadline = null;
                if (state === "open" && socket && lastInboundAt < pingSentAt) {
                    const failure = new Error(
                        `Heartbeat timeout: no inbound traffic within ${heartbeat.timeout}ms of a ping`
                    );
                    lastError = failure;
                    notify();
                    bus.emit("error", failure);
                    socket.close(HEARTBEAT_TIMEOUT_CODE, "heartbeat timeout");
                }
            }, heartbeat.timeout);
        }, heartbeat.interval);
    }

    /**
     * Final stage of the outbound pipeline: encode the (possibly transformed)
     * message and write it to the socket. The connection may have changed
     * while middleware awaited, so re-check here: if a retry is underway, the
     * *original* value is re-queued ahead of newer sends (middleware re-runs
     * at the next transmission, keeping e.g. tokens fresh); on a dead-end
     * state it surfaces as a `drop` — never silently lost.
     */
    function wire(transformed: unknown, original: unknown) {
        if (socket && state === "open") {
            socket.send(codec.encode(transformed));
            return;
        }
        if (
            queue !== null &&
            (state === "connecting" || state === "reconnecting")
        ) {
            if (queued.length >= queue.maxSize) {
                bus.emit("drop", {
                    data: queued.shift(),
                    reason: "overflow"
                });
                if (requeueIndex > 0) {
                    requeueIndex -= 1;
                }
            }
            queued.splice(requeueIndex, 0, original);
            requeueIndex += 1;
            notify();
            return;
        }
        bus.emit("drop", { data: original, reason: "close" });
    }

    /**
     * Runs one message through the outbound middleware chain. Errors are
     * per-message: a throw/rejection surfaces as `error` and only this
     * message is skipped.
     */
    function runOutbound(data: unknown): void | Promise<void> {
        const ctx = { data, client: api };
        try {
            const result = runPipeline(outboundMiddlewares, ctx, () => {
                wire(ctx.data, data);
            });
            if (result instanceof Promise) {
                return result.catch((error: unknown) => {
                    bus.emit("error", toError(error));
                });
            }
        } catch (error) {
            bus.emit("error", toError(error));
        }
    }

    /**
     * Sends a message through the outbound middleware pipeline, preserving
     * send() order: while any message is in flight (async middleware), newer
     * messages chain behind it. With no middleware in flight and an all-sync
     * chain, the path stays fully synchronous.
     */
    function transmit(data: unknown) {
        if (outboundTail === null) {
            const result = runOutbound(data);
            if (result instanceof Promise) {
                setOutboundTail(result);
            }
            return;
        }
        setOutboundTail(outboundTail.then(() => runOutbound(data)));
    }

    function setOutboundTail(run: Promise<void>) {
        const tail = run.then(() => {
            // Chain drained: restore the synchronous fast path.
            if (outboundTail === tail) {
                outboundTail = null;
            }
        });
        outboundTail = tail;
    }

    /**
     * Sends every queued message in order. Called once the socket opens,
     * *before* the `open` event, so the backlog (sent earlier in time)
     * precedes anything an `open` handler sends — under async outbound
     * middleware "precedes" means pipeline order; socket writes follow it.
     * A per-message encode/send failure surfaces as an `error` event and
     * flushing continues.
     */
    function flushQueue() {
        const hadQueued = queued.length > 0;
        requeueIndex = 0;
        while (queued.length > 0 && socket && state === "open") {
            const data = queued.shift();
            if (outboundMiddlewares.length === 0) {
                try {
                    socket.send(codec.encode(data));
                } catch (error) {
                    bus.emit("error", toError(error));
                }
            } else {
                transmit(data);
            }
        }
        if (hadQueued) {
            notify();
        }
    }

    /**
     * Empties the queue as `drop` events — these messages will never be sent
     * (user `close()` or terminal failure). Never silently lossy.
     */
    function dropQueued() {
        const hadQueued = queued.length > 0;
        while (queued.length > 0) {
            bus.emit("drop", { data: queued.shift(), reason: "close" });
        }
        if (hadQueued) {
            notify();
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
        if (lastError !== null) {
            lastError = null;
            notify();
        }
        socket = config.protocols
            ? new WebSocket(config.url, config.protocols)
            : new WebSocket(config.url);
        if (config.binaryType) {
            socket.binaryType = config.binaryType;
        }

        socket.onopen = () => {
            retryAttempt = 0;
            transition("OPEN");
            flushQueue();
            startHeartbeat();
            bus.emit("open");
            settleConnected();
        };

        socket.onmessage = (event: MessageEvent) => {
            lastInboundAt = Date.now();
            deliver(event.data);
        };

        socket.onerror = (event: Event) => {
            lastError = event;
            notify();
            bus.emit("error", event);
        };

        socket.onclose = (event: CloseEvent) => {
            const wasConnecting = state === "connecting";
            socket = null;
            stopHeartbeat();
            // A new disconnected period begins: in-flight outbound messages
            // re-queue from the front (see wire()).
            requeueIndex = 0;

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
     * Runs a decoded — and, if a schema is configured, validated — inbound
     * message through the middleware chain. If the chain completes, the
     * message is emitted as `message`; a middleware that throws or rejects
     * surfaces as an `error`. Validation precedes middleware, so middleware
     * only ever sees trusted data; an invalid message surfaces as an `error`
     * (`SchemaValidationError`) and never reaches middleware or `message`.
     */
    function deliver(raw: unknown) {
        const decoded = codec.decode(raw);
        if (config.schema === undefined) {
            dispatchMessage(decoded);
            return;
        }
        let result: ReturnType<StandardSchemaV1["~standard"]["validate"]>;
        try {
            result = config.schema["~standard"].validate(decoded);
        } catch (error) {
            bus.emit("error", toError(error));
            return;
        }
        if (result instanceof Promise) {
            result.then(handleValidated, (error: unknown) => {
                bus.emit("error", toError(error));
            });
            return;
        }
        handleValidated(result);
    }

    function handleValidated(result: StandardSchemaV1.Result<unknown>) {
        if (result.issues) {
            bus.emit("error", new SchemaValidationError(result.issues));
            return;
        }
        dispatchMessage(result.value);
    }

    function dispatchMessage(data: unknown) {
        const ctx = { data, client: api };
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
                if (outboundMiddlewares.length === 0) {
                    // No outbound middleware: today's direct path, including
                    // synchronous encode errors thrown to the caller.
                    socket.send(codec.encode(data));
                } else {
                    transmit(data);
                }
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
                notify();
                return;
            }
            throw new Error(
                `Cannot send: connection is not open (state: "${state}")`
            );
        },

        close(code?: number, reason?: string) {
            closeRequested = true;
            clearRetryTimer();
            stopHeartbeat();
            if (retryAttempt !== 0) {
                retryAttempt = 0;
                notify();
            }
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

        use(middleware: Middleware | DirectionalMiddleware) {
            if (typeof middleware === "function") {
                middlewares.push(middleware);
                return api;
            }
            if (middleware.inbound) {
                middlewares.push(middleware.inbound);
            }
            if (middleware.outbound) {
                outboundMiddlewares.push(middleware.outbound);
            }
            return api;
        },

        getState(): ClientState {
            if (snapshot === null) {
                snapshot = Object.freeze({
                    state,
                    lastError,
                    retryAttempt,
                    queueLength: queued.length
                });
            }
            return snapshot;
        },

        subscribe(listener: () => void) {
            subscribers.add(listener);
            return () => {
                subscribers.delete(listener);
            };
        }
    };

    return api;
}

/** Normalize an unknown thrown value into an `Error`. */
function toError(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value));
}
