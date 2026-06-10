import type { StandardSchemaV1 } from "@/schema";

/**
 * Translates between application values and WebSocket wire frames.
 *
 * The codec is the single seam where serialization lives: `send()` runs values
 * through `encode`, and incoming frames are run through `decode` before being
 * emitted as `message`. The default is JSON (see `codec.ts`); supply your own
 * for binary protocols, schema-based formats, etc.
 */
export interface Codec {
    /**
     * Encode an outgoing value into a WebSocket-sendable frame.
     *
     * The return type deliberately mirrors `WebSocket.send`'s parameter
     * (`BufferSource` is its exact alias), so the codec contract can never
     * drift looser than what the socket accepts — e.g. TS 6's lib excludes
     * `SharedArrayBuffer`-backed views from `send`, and this excludes them too.
     */
    encode(data: unknown): string | BufferSource | Blob;
    /** Decode an incoming frame (`string` for text, `ArrayBuffer`/`Blob` for binary). */
    decode(data: unknown): unknown;
}

/**
 * Tuning for automatic reconnection. All fields optional — the defaults give
 * full-jitter exponential backoff with unlimited retries.
 */
export interface ReconnectOptions {
    /** First-retry delay ceiling in ms. Default `500`. */
    readonly baseDelay?: number;
    /** Exponential growth factor. Default `2`. */
    readonly factor?: number;
    /** Delay ceiling in ms. Default `30_000`. */
    readonly maxDelay?: number;
    /**
     * Full jitter: each delay is drawn uniformly from `[0, computed]`, so a
     * fleet of clients dropped at once doesn't retry in synchronized waves.
     * Default `true`; set `false` for exact exponential delays.
     */
    readonly jitter?: boolean;
    /** Retries per disconnection before giving up. Default `Infinity`. */
    readonly maxRetries?: number;
    /**
     * Decide per-close whether to reconnect (e.g. skip auth rejections by
     * close code). Default: always reconnect. User-initiated `close()` never
     * reconnects, regardless of this.
     */
    readonly shouldReconnect?: (event: CloseEvent) => boolean;
}

/**
 * Opt-in liveness checking. When configured, the client sends `message` every
 * `interval` ms while open; if **no inbound frame of any kind** arrives within
 * `timeout` ms of a ping, the link is declared dead and force-closed (code
 * `4408`), which flows into the normal reconnect machinery.
 *
 * Requires a server that responds to the heartbeat message (or talks
 * regularly for other reasons) — that app-level contract is why heartbeat is
 * opt-in rather than on by default.
 */
export interface HeartbeatOptions {
    /** Milliseconds between pings. */
    readonly interval: number;
    /** The ping payload, run through the codec. Default `"ping"`. */
    readonly message?: unknown;
    /**
     * Milliseconds after a ping to wait for inbound traffic before declaring
     * the link dead. Default: `interval`.
     */
    readonly timeout?: number;
}

/**
 * Tuning for the outbound message queue.
 */
export interface QueueOptions {
    /**
     * Maximum queued messages. When full, the **oldest** is dropped and a
     * `drop` event fires — never silently unbounded, never silently lossy.
     * Default `256`.
     */
    readonly maxSize?: number;
}

/**
 * Configuration options for the WebSocket client.
 */
export interface WebSocketClientConfig {
    /** The URL to connect to. */
    readonly url: string | URL;
    /** Optional subprotocol(s) passed to the underlying `WebSocket`. */
    readonly protocols?: string | string[];
    /** Wire-format codec. Defaults to JSON (`jsonCodec`). */
    readonly codec?: Codec;
    /**
     * Automatic reconnection — **on by default** (durable by default). Pass
     * `false` to disable, or options to tune the backoff.
     */
    readonly reconnect?: false | ReconnectOptions;
    /**
     * Outbound queueing while disconnected — **on by default**. `send()`
     * during `connecting`/`reconnecting` queues and flushes in order on open.
     * Pass `false` to make `send()` throw whenever the socket isn't open.
     */
    readonly queue?: false | QueueOptions;
    /**
     * Liveness checking — **opt-in** (off unless configured). See
     * {@link HeartbeatOptions}.
     */
    readonly heartbeat?: HeartbeatOptions;
    /**
     * A [Standard Schema](https://standardschema.dev) (zod, valibot, arktype,
     * …) validating every **inbound** message after `codec.decode` and before
     * middleware. Valid messages flow on with the schema's output value;
     * invalid ones surface as an `error` event (`SchemaValidationError`) and
     * are never emitted as `message`. When passed to `defineClient`, the
     * message type is **inferred from the schema** — no generics needed.
     */
    readonly schema?: StandardSchemaV1;
}

/**
 * The states a connection can occupy. This is the public, observable lifecycle.
 *
 * - `idle` — created but never connected.
 * - `connecting` — a socket is open-in-progress, awaiting the first `open`.
 * - `open` — connected and ready to send/receive.
 * - `closing` — a close has been requested, awaiting the socket to finish.
 * - `reconnecting` — the connection dropped; waiting out the backoff delay
 *   before the next attempt.
 * - `closed` — the socket is closed; the client may `connect()` again.
 */
export type ConnectionState =
    | "idle"
    | "connecting"
    | "open"
    | "closing"
    | "reconnecting"
    | "closed";

/**
 * The internal events that drive the connection FSM.
 *
 * `OPEN` / `CLOSED` originate from the underlying socket; `CONNECT` /
 * `CLOSE_REQUESTED` originate from the user calling `connect()` / `close()`;
 * `RETRY` is fired when a reconnect attempt is scheduled. Transport errors are
 * handled out-of-band and are not FSM events — see `fsm.ts`.
 */
export type ConnectionEvent =
    | "CONNECT"
    | "OPEN"
    | "CLOSE_REQUESTED"
    | "CLOSED"
    | "RETRY";

/**
 * A read-only snapshot of the client's observable state. Bounded by design —
 * it holds lifecycle, never message history.
 */
export interface ClientState {
    /** The current connection state. */
    readonly state: ConnectionState;
    /**
     * The most recent failure, if any: a transport error (`Event`) or a
     * client-detected one like a heartbeat timeout (`Error`).
     */
    readonly lastError: Event | Error | null;
    /**
     * Retries used in the current disconnection episode. `0` while healthy;
     * resets on a successful open or a user `close()`.
     */
    readonly retryAttempt: number;
    /** Messages currently waiting in the outbound queue. */
    readonly queueLength: number;
}

/**
 * Payload emitted on every `drop` event — a queued outbound message that will
 * never be sent.
 */
export interface DropEvent<TOut = unknown> {
    /** The original (un-encoded) value passed to `send()`. */
    readonly data: TOut;
    /**
     * Why it was dropped: `overflow` — the queue was full and this was the
     * oldest entry; `close` — the connection ended (user `close()` or terminal
     * failure) with messages still queued.
     */
    readonly reason: "overflow" | "close";
}

/**
 * Payload emitted on every `reconnecting` event (one per scheduled retry).
 */
export interface ReconnectingEvent {
    /** 1-based retry number within this disconnection episode. */
    readonly attempt: number;
    /** The backoff delay (ms) before this attempt fires. */
    readonly delay: number;
}

/**
 * The context handed to each message middleware.
 */
export interface MessageContext<TIn = unknown> {
    /**
     * The decoded (and, if a schema is configured, validated) inbound message.
     * Middleware may reassign this to transform what later middleware — and
     * the `message` event — receive.
     */
    data: TIn;
    /** The client, e.g. for sending a reply from within the pipeline. */
    readonly client: WebSocketClient<TIn>;
}

/**
 * Message middleware, run in registration order for each inbound message.
 *
 * Call `next()` to pass control to the next middleware; the message is emitted
 * as a `message` event only if the whole chain calls through. Return without
 * calling `next()` to short-circuit (e.g. an auto-reply that shouldn't bubble).
 * May be async.
 */
export type Middleware<TIn = unknown> = (
    ctx: MessageContext<TIn>,
    next: () => void | Promise<void>
) => void | Promise<void>;

/**
 * Payload emitted on every `statechange`.
 */
export interface StateChange {
    /** The state being left. */
    readonly previous: ConnectionState;
    /** The state being entered. */
    readonly current: ConnectionState;
}

/**
 * The events a client emits, mapped to their payload types. Used to give
 * `on()` precise, per-event payload typing.
 */
export interface ClientEventMap<TIn = unknown, TOut = unknown> {
    /** The socket opened. */
    open: undefined;
    /** A message was received, decoded, and (if configured) validated. */
    message: TIn;
    /** The socket closed (clean or otherwise). */
    close: CloseEvent;
    /**
     * Something failed: a transport error (an `Event` from the socket) or a
     * middleware that threw/rejected (an `Error`).
     */
    error: Event | Error;
    /** The connection state changed. */
    statechange: StateChange;
    /** A reconnect attempt was scheduled (fires once per retry). */
    reconnecting: ReconnectingEvent;
    /** A queued outbound message was dropped and will never be sent. */
    drop: DropEvent<TOut>;
}

/**
 * A resilient, zero-dependency WebSocket client.
 *
 * @typeParam TIn - The type of inbound messages (what `on("message")`
 * handlers receive). Inferred from `config.schema` when one is given.
 * @typeParam TOut - The type accepted by `send()`.
 */
export interface WebSocketClient<TIn = unknown, TOut = unknown> {
    /** The current connection state. */
    readonly state: ConnectionState;

    /**
     * Opens the connection.
     *
     * Resolves the first time the socket opens — including when that open is
     * a successful *retry* (the promise survives failed attempts while
     * reconnection is active). Calling it while already `open` resolves
     * immediately; calling it while `connecting` returns the same in-flight
     * promise (idempotent); calling it while `reconnecting` skips the backoff
     * wait and attempts immediately.
     *
     * Rejects only on **terminal** failure: retries exhausted
     * (`reconnect.maxRetries`), a `shouldReconnect` veto, `close()` before the
     * first open, or — with `reconnect: false` — any close before opening.
     *
     * **Under the default `maxRetries: Infinity`, this promise never rejects**:
     * against a down host it stays pending while the client keeps retrying.
     * That is the durable-by-default contract, by design. If you need a
     * deadline, set a finite `maxRetries` or race it:
     * `Promise.race([client.connect(), timeout(10_000)])`.
     *
     * Failures *after* the first open surface via the `error` / `close` /
     * `reconnecting` events, not this promise. For fire-and-forget use, attach
     * a `.catch` or listen for `error` to avoid an unhandled rejection.
     */
    connect(): Promise<void>;

    /**
     * Sends data over the connection. Non-string data is encoded (JSON by
     * default).
     *
     * While `connecting` or `reconnecting`, the message is **queued** (bounded,
     * drop-oldest — see `queue` config) and flushed in order when the socket
     * opens; queued messages that will never send surface as `drop` events.
     * Throws when the client is `idle`, `closing`, or `closed` — states where
     * no open is coming — or whenever the socket isn't open if `queue: false`.
     */
    send(data: TOut): void;

    /**
     * Closes the connection.
     * @param code - Optional close code (see `error.ts`).
     * @param reason - Optional human-readable close reason.
     */
    close(code?: number, reason?: string): void;

    /**
     * Subscribes to a client event.
     * @returns an unsubscribe function.
     */
    on<K extends keyof ClientEventMap<TIn, TOut>>(
        event: K,
        handler: (payload: ClientEventMap<TIn, TOut>[K]) => void
    ): () => void;

    /**
     * Registers message middleware, run in order for each inbound message.
     * @returns the client, for chaining.
     */
    use(middleware: Middleware<TIn>): WebSocketClient<TIn, TOut>;

    /**
     * Returns a read-only snapshot of the client's observable state.
     *
     * The snapshot is **referentially stable**: repeated calls return the same
     * frozen object until something actually changes. Together with
     * {@link subscribe} this is exactly the `subscribe`/`getSnapshot` pair
     * React's `useSyncExternalStore` requires, and it drives Vue/Svelte
     * reactivity equally well.
     */
    getState(): ClientState;

    /**
     * Subscribes to **any** change of the observable snapshot — connection
     * state, `lastError`, `retryAttempt`, or `queueLength`. Unlike
     * `on("statechange")` (which fires only on FSM transitions), this also
     * fires when, e.g., the queue grows on a `send()` while disconnected.
     *
     * The listener receives no arguments; read `getState()` for the new
     * snapshot.
     *
     * @returns an unsubscribe function.
     */
    subscribe(listener: () => void): () => void;
}

/**
 * Event bus interface for managing event subscriptions and emissions.
 */
export interface EventBus {
    on<T = unknown>(eventName: string, handler: (payload: T) => void): void;
    off<T = unknown>(eventName: string, handler: (payload: T) => void): void;
    emit<T = unknown>(eventName: string, payload?: T): void;
    once<T = unknown>(eventName: string, handler: (payload: T) => void): void;
}
