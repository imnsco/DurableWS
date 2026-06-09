/**
 * Translates between application values and WebSocket wire frames.
 *
 * The codec is the single seam where serialization lives: `send()` runs values
 * through `encode`, and incoming frames are run through `decode` before being
 * emitted as `message`. The default is JSON (see `codec.ts`); supply your own
 * for binary protocols, schema-based formats, etc.
 */
export interface Codec {
    /** Encode an outgoing value into a WebSocket-sendable frame. */
    encode(data: unknown): string | ArrayBufferLike | Blob | ArrayBufferView;
    /** Decode an incoming frame (`string` for text, `ArrayBuffer`/`Blob` for binary). */
    decode(data: unknown): unknown;
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
}

/**
 * The states a connection can occupy. This is the public, observable lifecycle.
 *
 * - `idle` — created but never connected.
 * - `connecting` — a socket is open-in-progress, awaiting the first `open`.
 * - `open` — connected and ready to send/receive.
 * - `closing` — a close has been requested, awaiting the socket to finish.
 * - `closed` — the socket is closed; the client may `connect()` again.
 *
 * (Reconnection introduces a `reconnecting` state in M3.)
 */
export type ConnectionState =
    | "idle"
    | "connecting"
    | "open"
    | "closing"
    | "closed";

/**
 * The internal events that drive the connection FSM.
 *
 * `OPEN` / `CLOSED` originate from the underlying socket; `CONNECT` /
 * `CLOSE_REQUESTED` originate from the user calling `connect()` / `close()`.
 * Transport errors are handled out-of-band and are not FSM events — see `fsm.ts`.
 */
export type ConnectionEvent = "CONNECT" | "OPEN" | "CLOSE_REQUESTED" | "CLOSED";

/**
 * A read-only snapshot of the client's observable state. Bounded by design —
 * it holds lifecycle, never message history.
 */
export interface ClientState {
    /** The current connection state. */
    readonly state: ConnectionState;
    /** The most recent transport error, if any. */
    readonly lastError: Event | null;
}

/**
 * The context handed to each message middleware.
 */
export interface MessageContext {
    /**
     * The decoded inbound message. Middleware may reassign this to transform
     * what later middleware — and the `message` event — receive.
     */
    data: unknown;
    /** The client, e.g. for sending a reply from within the pipeline. */
    readonly client: WebSocketClient;
}

/**
 * Message middleware, run in registration order for each inbound message.
 *
 * Call `next()` to pass control to the next middleware; the message is emitted
 * as a `message` event only if the whole chain calls through. Return without
 * calling `next()` to short-circuit (e.g. an auto-reply that shouldn't bubble).
 * May be async.
 */
export type Middleware = (
    ctx: MessageContext,
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
export interface ClientEventMap {
    /** The socket opened. */
    open: undefined;
    /** A message was received and decoded. */
    message: unknown;
    /** The socket closed (clean or otherwise). */
    close: CloseEvent;
    /**
     * Something failed: a transport error (an `Event` from the socket) or a
     * middleware that threw/rejected (an `Error`).
     */
    error: Event | Error;
    /** The connection state changed. */
    statechange: StateChange;
}

/**
 * A resilient, zero-dependency WebSocket client.
 */
export interface WebSocketClient {
    /** The current connection state. */
    readonly state: ConnectionState;

    /**
     * Opens the connection.
     *
     * Resolves the first time the socket opens. Calling it while already
     * `open` resolves immediately; calling it while `connecting` returns the
     * same in-flight promise (idempotent). Rejects only on a terminal failure —
     * in this release, a connection that closes before it ever opens.
     *
     * Failures *after* the first open surface via the `error` / `close` events,
     * not this promise. For fire-and-forget use, attach a `.catch` or listen
     * for `error` to avoid an unhandled rejection.
     */
    connect(): Promise<void>;

    /**
     * Sends data over the connection. Non-string data is encoded (JSON by
     * default). Throws if the connection is not open.
     */
    send(data: unknown): void;

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
    on<K extends keyof ClientEventMap>(
        event: K,
        handler: (payload: ClientEventMap[K]) => void
    ): () => void;

    /**
     * Registers message middleware, run in order for each inbound message.
     * @returns the client, for chaining.
     */
    use(middleware: Middleware): WebSocketClient;

    /**
     * Returns a read-only snapshot of the client's observable state.
     */
    getState(): ClientState;
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
