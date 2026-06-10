/**
 * Drop-in `WebSocket` compatibility — `import { WebSocket } from "durablews/compat"`.
 *
 * A `WebSocket`-shaped class over the durable core, for two audiences:
 * one-line migration of app code that constructs sockets directly, and
 * `webSocketImpl`-style injection points in existing libraries (graphql-ws,
 * y-websocket, realtime SDKs). Fidelity is scoped to those use cases — the
 * known deviations are documented on the docs site, not hidden.
 */
import { client } from "@/client";
import type { Codec, WebSocketClient, WebSocketClientConfig } from "@/types";

/**
 * Compat is wire-faithful: no JSON, no transforms. What you send is what the
 * socket sends; what arrives is what you receive.
 */
const rawCodec: Codec = {
    // The class's send() signature restricts inputs to WebSocket-sendable
    // values, so the cast only widens what TypeScript already enforced there.
    encode: (data) => data as string | BufferSource | Blob,
    decode: (data) => data
};

type CloseEventInitLike = {
    code?: number;
    reason?: string;
    wasClean?: boolean;
};

/**
 * `CloseEvent` exists in browsers, Deno, Bun, and recent Node — but not in
 * every runtime durablews supports, so fall back to a structural equivalent.
 */
const CloseEventCtor: new (
    type: string,
    init?: CloseEventInitLike
) => CloseEvent =
    typeof CloseEvent !== "undefined"
        ? CloseEvent
        : (class extends Event {
              readonly code: number;
              readonly reason: string;
              readonly wasClean: boolean;
              constructor(type: string, init: CloseEventInitLike = {}) {
                  super(type);
                  this.code = init.code ?? 0;
                  this.reason = init.reason ?? "";
                  this.wasClean = init.wasClean ?? false;
              }
          } as unknown as new (
              type: string,
              init?: CloseEventInitLike
          ) => CloseEvent);

/** The durablews options accepted as the constructor's third argument. */
export type DurableWebSocketOptions = Omit<
    WebSocketClientConfig,
    "url" | "protocols" | "codec" | "schema"
>;

/**
 * A drop-in `WebSocket` that reconnects, with the durable core underneath:
 * full-jitter backoff, bounded queueing, opt-in heartbeat.
 *
 * ```ts
 * import { WebSocket } from "durablews/compat";
 *
 * const ws = new WebSocket("wss://example.com/socket");
 * ws.onmessage = (event) => console.log(event.data);
 * ```
 *
 * Or injected where a library accepts an implementation:
 *
 * ```ts
 * createClient({ url, webSocketImpl: WebSocket }); // graphql-ws
 * ```
 *
 * The underlying durablews client is exposed as `.client` for everything the
 * `WebSocket` shape can't say (state machine, `drop` events, middleware).
 */
export class DurableWebSocket extends EventTarget {
    static readonly CONNECTING = 0 as const;
    static readonly OPEN = 1 as const;
    static readonly CLOSING = 2 as const;
    static readonly CLOSED = 3 as const;

    readonly CONNECTING = 0 as const;
    readonly OPEN = 1 as const;
    readonly CLOSING = 2 as const;
    readonly CLOSED = 3 as const;

    /** The underlying durablews client — the escape hatch to the full API. */
    readonly client: WebSocketClient;

    readonly url: string;
    /** Always `""` — see the known-deviations table in the docs. */
    readonly protocol = "";
    /** Always `""` — see the known-deviations table in the docs. */
    readonly extensions = "";
    /** Always `0` — see the known-deviations table in the docs. */
    readonly bufferedAmount = 0;

    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;

    #binaryType: BinaryType;
    // Serializes Blob → ArrayBuffer conversions so message order survives the
    // async hop when binaryType is reassigned after construction. While no
    // conversion is pending, delivery is fully synchronous (native-faithful).
    #deliveryChain: Promise<void> = Promise.resolve();
    #pendingDeliveries = 0;

    constructor(
        url: string | URL,
        protocols?: string | string[],
        options: DurableWebSocketOptions = {}
    ) {
        super();
        this.url = String(url);
        this.#binaryType = options.binaryType ?? "blob";
        this.client = client({
            ...options,
            url,
            protocols,
            codec: rawCodec
        });

        this.client.on("open", () => {
            const event = new Event("open");
            this.dispatchEvent(event);
            this.onopen?.call(this, event);
        });
        this.client.on("message", (data) => {
            this.#deliverMessage(data);
        });
        this.client.on("close", (event) => {
            // Re-dispatched as a fresh event: the original already completed
            // its dispatch on the underlying socket.
            const compatEvent = new CloseEventCtor("close", {
                code: event.code,
                reason: event.reason,
                wasClean: event.wasClean
            });
            this.dispatchEvent(compatEvent);
            this.onclose?.call(this, compatEvent);
        });
        this.client.on("error", () => {
            // Native WebSocket error events carry no payload either.
            const event = new Event("error");
            this.dispatchEvent(event);
            this.onerror?.call(this, event);
        });

        // A WebSocket connects on construction. Failures surface as
        // error/close events, exactly like the native class.
        this.client.connect().catch(() => {});
    }

    /**
     * Maps the durable lifecycle onto the four native states. Deviation by
     * design: during automatic reconnection this returns to `CONNECTING`,
     * which a native (one-shot) socket can never do.
     */
    get readyState(): number {
        switch (this.client.state) {
            case "open":
                return DurableWebSocket.OPEN;
            case "closing":
                return DurableWebSocket.CLOSING;
            case "closed":
                return DurableWebSocket.CLOSED;
            default: // idle | connecting | reconnecting
                return DurableWebSocket.CONNECTING;
        }
    }

    get binaryType(): BinaryType {
        return this.#binaryType;
    }

    /**
     * Honored at any time: when set to `"arraybuffer"` after construction,
     * `Blob` frames are converted on delivery (order-preserving). Prefer
     * passing `binaryType` in the constructor options, which configures the
     * socket itself and avoids the conversion copy.
     */
    set binaryType(value: BinaryType) {
        this.#binaryType = value;
    }

    /**
     * Sends data, with durability semantics: while (re)connecting the message
     * is queued and flushed on open (a native socket would throw). After
     * `close()` it is silently discarded, matching native behavior.
     */
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        if (
            this.client.state === "idle" ||
            this.client.state === "closing" ||
            this.client.state === "closed"
        ) {
            // Native sockets don't throw on send-after-close; stay faithful.
            return;
        }
        this.client.send(data);
    }

    close(code?: number, reason?: string) {
        this.client.close(code, reason);
    }

    #deliverMessage(data: unknown) {
        const dispatch = (value: unknown) => {
            const event = new MessageEvent("message", { data: value });
            this.dispatchEvent(event);
            this.onmessage?.call(this, event);
        };
        // Emulation path: binaryType was set to "arraybuffer" after
        // construction, but the socket is still delivering Blobs.
        if (
            this.#binaryType === "arraybuffer" &&
            typeof Blob !== "undefined" &&
            data instanceof Blob
        ) {
            this.#queueDelivery(async () => {
                try {
                    dispatch(await blobToArrayBuffer(data));
                } catch {
                    // Conversion unavailable: raw delivery beats silence.
                    dispatch(data);
                }
            });
            return;
        }
        if (this.#pendingDeliveries === 0) {
            // The common case: no conversion in flight → synchronous,
            // exactly like a native socket.
            dispatch(data);
            return;
        }
        // A conversion is ahead of us: queue behind it to preserve order.
        this.#queueDelivery(() => {
            dispatch(data);
        });
    }

    #queueDelivery(deliver: () => void | Promise<void>) {
        this.#pendingDeliveries += 1;
        this.#deliveryChain = this.#deliveryChain
            .then(deliver)
            // A listener throwing must not poison the chain for later
            // messages; native dispatch isolates listener errors too.
            .catch(() => {})
            .finally(() => {
                this.#pendingDeliveries -= 1;
            });
    }
}

/**
 * `Blob.arrayBuffer()` with a `FileReader` fallback — jsdom (a popular test
 * environment for apps using this class) ships `Blob` without the method.
 */
function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
    if (typeof blob.arrayBuffer === "function") {
        return blob.arrayBuffer();
    }
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            resolve(reader.result as ArrayBuffer);
        };
        reader.onerror = () => {
            reject(reader.error ?? new Error("Blob read failed"));
        };
        reader.readAsArrayBuffer(blob);
    });
}

export { DurableWebSocket as WebSocket };
