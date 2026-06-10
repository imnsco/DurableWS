import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// https://github.com/akiomik/vitest-websocket-mock
import WS from "vitest-websocket-mock";
import { client } from "../src/client";
import { pingpong } from "../src/middleware";
import { SchemaValidationError } from "../src/schema";
import type { Middleware, WebSocketClient } from "../src/types";

const URL = "ws://localhost:1234";

describe("client", () => {
    let server: WS;
    let ws: WebSocketClient;

    beforeEach(() => {
        server = new WS(URL);
        // Reconnection is exercised by its own suite below; these tests verify
        // the non-reconnect mechanics, so terminal-close semantics apply.
        ws = client({ url: URL, reconnect: false });
    });

    afterEach(() => {
        WS.clean();
    });

    async function connected() {
        const opened = ws.connect();
        await server.connected;
        await opened;
    }

    it("starts idle and opens", async () => {
        expect(ws.state).toBe("idle");
        await connected();
        expect(ws.state).toBe("open");
    });

    it("connect() resolves on first open and emits open + statechange", async () => {
        const onOpen = vi.fn();
        const onStateChange = vi.fn();
        ws.on("open", onOpen);
        ws.on("statechange", onStateChange);

        await connected();

        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(onStateChange).toHaveBeenCalledWith({
            previous: "connecting",
            current: "open"
        });
    });

    it("connect() is idempotent once open", async () => {
        await connected();
        await expect(ws.connect()).resolves.toBeUndefined();
        expect(ws.state).toBe("open");
    });

    it("connect() while connecting returns the same in-flight promise", () => {
        const first = ws.connect();
        const second = ws.connect();
        expect(second).toBe(first);
        // Never driven to open; swallow the rejection from teardown closing the
        // still-connecting socket so it isn't reported as unhandled.
        first.catch(() => {});
    });

    it("connect() rejects if the socket closes before opening", async () => {
        const opening = ws.connect();
        server.close();
        await expect(opening).rejects.toThrow(/before opening/);
        expect(ws.state).toBe("closed");
    });

    it("sends a string as-is and objects as JSON", async () => {
        await connected();

        ws.send("raw");
        await expect(server).toReceiveMessage("raw");

        const payload = { type: "test", value: 1 };
        ws.send(payload);
        await expect(server).toReceiveMessage(JSON.stringify(payload));
    });

    it("throws when sending while not open", () => {
        expect(() => ws.send("nope")).toThrow(/not open/);
    });

    it("delivers decoded incoming messages", async () => {
        await connected();
        const onMessage = vi.fn();
        ws.on("message", onMessage);

        server.send(JSON.stringify({ data: "hello" }));

        expect(onMessage).toHaveBeenCalledWith(
            expect.objectContaining({ data: "hello" })
        );
    });

    it("uses a custom codec for both encode and decode", async () => {
        const codec = {
            encode: (data: unknown) => `<${String(data)}>`,
            decode: (data: unknown) => `decoded:${String(data)}`
        };
        const customUrl = "ws://localhost:1235";
        const customServer = new WS(customUrl);
        const custom = client({ url: customUrl, codec, reconnect: false });

        const opened = custom.connect();
        await customServer.connected;
        await opened;

        custom.send("hi");
        await expect(customServer).toReceiveMessage("<hi>");

        const onMessage = vi.fn();
        custom.on("message", onMessage);
        customServer.send("raw");
        expect(onMessage).toHaveBeenCalledWith("decoded:raw");
    });

    it("runs middleware for each inbound message, then emits message", async () => {
        const seen: unknown[] = [];
        ws.use((ctx, next) => {
            seen.push(ctx.data);
            return next();
        });
        const onMessage = vi.fn();
        ws.on("message", onMessage);

        await connected();
        server.send(JSON.stringify({ n: 1 }));

        expect(seen).toEqual([{ n: 1 }]);
        expect(onMessage).toHaveBeenCalledWith({ n: 1 });
    });

    it("middleware can transform the emitted message", async () => {
        ws.use((ctx, next) => {
            ctx.data = { ...(ctx.data as object), tagged: true };
            return next();
        });
        const onMessage = vi.fn();
        ws.on("message", onMessage);

        await connected();
        server.send(JSON.stringify({ n: 1 }));

        expect(onMessage).toHaveBeenCalledWith({ n: 1, tagged: true });
    });

    it("middleware can short-circuit so no message is emitted", async () => {
        ws.use(() => {
            /* swallow: never calls next() */
        });
        const onMessage = vi.fn();
        ws.on("message", onMessage);

        await connected();
        server.send(JSON.stringify({ n: 1 }));

        expect(onMessage).not.toHaveBeenCalled();
    });

    it("use() returns the client for chaining", () => {
        const noop: Middleware = (_c, next) => next();
        expect(ws.use(noop)).toBe(ws);
    });

    it("emits error when a middleware throws", async () => {
        ws.use(() => {
            throw new Error("boom");
        });
        const onError = vi.fn();
        ws.on("error", onError);

        await connected();
        server.send(JSON.stringify({ n: 1 }));

        expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it("pingpong replies to ping without emitting it as a message", async () => {
        ws.use(pingpong);
        const onMessage = vi.fn();
        ws.on("message", onMessage);

        await connected();
        server.send("ping");

        await expect(server).toReceiveMessage("pong");
        expect(onMessage).not.toHaveBeenCalled();
    });

    it("transitions to closed and emits close on close()", async () => {
        await connected();
        const onClose = vi.fn();
        ws.on("close", onClose);

        ws.close();
        await server.closed;

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(ws.state).toBe("closed");
        expect(ws.getState().state).toBe("closed");
    });

    it("transitions to closed on a remote close", async () => {
        await connected();
        server.close();
        await server.closed;
        expect(ws.state).toBe("closed");
    });

    it("surfaces transport errors via on(error) and getState().lastError", async () => {
        await connected();
        const onError = vi.fn();
        ws.on("error", onError);

        server.error();

        expect(onError).toHaveBeenCalledTimes(1);
        expect(ws.getState().lastError).not.toBeNull();
    });

    it("can reconnect after closing", async () => {
        await connected();
        ws.close();
        await server.closed;
        expect(ws.state).toBe("closed");

        WS.clean();
        server = new WS(URL);
        await connected();
        expect(ws.state).toBe("open");
    });

    it("on() returns an unsubscribe that stops delivery", async () => {
        await connected();
        const onMessage = vi.fn();
        const off = ws.on("message", onMessage);

        server.send(JSON.stringify({ n: 1 }));
        expect(onMessage).toHaveBeenCalledTimes(1);

        off();
        server.send(JSON.stringify({ n: 2 }));
        expect(onMessage).toHaveBeenCalledTimes(1);
    });

    it("getState() returns a frozen snapshot", async () => {
        await connected();
        const snapshot = ws.getState();
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(snapshot).toEqual({
            state: "open",
            lastError: null,
            retryAttempt: 0,
            queueLength: 0
        });
    });

    it("emits the full statechange sequence across a connect/close cycle", async () => {
        const states: string[] = [];
        ws.on("statechange", ({ current }) => states.push(current));

        await connected();
        ws.close();
        await server.closed;

        expect(states).toEqual(["connecting", "open", "closing", "closed"]);
    });

    it("connect() while closing rejects", async () => {
        await connected();
        ws.close();
        expect(ws.state).toBe("closing");

        await expect(ws.connect()).rejects.toThrow(/closing/);
        await server.closed;
    });
});

describe("reconnection", () => {
    const RURL = "ws://localhost:1240";
    let server: WS;

    afterEach(() => {
        WS.clean();
    });

    async function open(c: WebSocketClient) {
        const opened = c.connect();
        await server.connected;
        await opened;
    }

    it("retries an unexpected close: statechange → close → reconnecting", async () => {
        server = new WS(RURL);
        const c = client({
            url: RURL,
            reconnect: { baseDelay: 30_000, jitter: false }
        });
        const order: string[] = [];
        c.on("statechange", ({ current }) => order.push(`state:${current}`));
        c.on("close", () => order.push("close"));
        c.on("reconnecting", ({ attempt, delay }) =>
            order.push(`reconnecting:${attempt}:${delay}`)
        );
        await open(c);

        server.close();
        await vi.waitFor(() => expect(c.state).toBe("reconnecting"));

        expect(order).toEqual([
            "state:connecting",
            "state:open",
            "state:reconnecting",
            "close",
            "reconnecting:1:30000"
        ]);
        expect(c.getState().retryAttempt).toBe(1);
        c.close();
    });

    it("reconnects when the server comes back and resets retryAttempt", async () => {
        server = new WS(RURL);
        const c = client({
            url: RURL,
            reconnect: { baseDelay: 10, jitter: false }
        });
        await open(c);

        server.close();
        WS.clean();
        server = new WS(RURL);

        await vi.waitFor(() => expect(c.state).toBe("open"), {
            timeout: 2000
        });
        expect(c.getState().retryAttempt).toBe(0);
        c.close();
    });

    it("connect() survives a down server and resolves on a successful retry", async () => {
        // No server yet — the first attempt fails and retries begin.
        const c = client({
            url: RURL,
            reconnect: { baseDelay: 10, jitter: false }
        });
        const opened = c.connect();
        await vi.waitFor(() => expect(c.state).toBe("reconnecting"));

        server = new WS(RURL);
        await opened;
        expect(c.state).toBe("open");
        c.close();
    });

    it("rejects connect() once maxRetries is exhausted", async () => {
        const c = client({
            url: RURL,
            reconnect: { baseDelay: 5, jitter: false, maxRetries: 2 }
        });
        await expect(c.connect()).rejects.toThrow(/gave up after 2 attempt/);
        expect(c.state).toBe("closed");
        expect(c.getState().retryAttempt).toBe(2);
    });

    it("honors a shouldReconnect veto", async () => {
        server = new WS(RURL);
        const c = client({
            url: RURL,
            reconnect: { shouldReconnect: () => false }
        });
        await open(c);

        server.close();
        await vi.waitFor(() => expect(c.state).toBe("closed"));
        expect(c.getState().retryAttempt).toBe(0);
    });

    it("never reconnects after a user close()", async () => {
        server = new WS(RURL);
        const c = client({
            url: RURL,
            reconnect: { baseDelay: 5, jitter: false }
        });
        await open(c);

        c.close();
        await server.closed;
        expect(c.state).toBe("closed");

        // Give a would-be retry window time to fire, then re-assert.
        await new Promise((r) => setTimeout(r, 30));
        expect(c.state).toBe("closed");
    });

    it("close() during reconnecting cancels the retry and rejects connect()", async () => {
        const c = client({
            url: RURL,
            reconnect: { baseDelay: 60_000, jitter: false }
        });
        const opened = c.connect();
        await vi.waitFor(() => expect(c.state).toBe("reconnecting"));

        c.close();
        expect(c.state).toBe("closed");
        await expect(opened).rejects.toThrow(/close\(\) called/);
    });

    it("connect() during reconnecting skips the backoff and attempts now", async () => {
        const c = client({
            url: RURL,
            reconnect: { baseDelay: 60_000, jitter: false }
        });
        const opened = c.connect();
        await vi.waitFor(() => expect(c.state).toBe("reconnecting"));

        server = new WS(RURL);
        const retried = c.connect();
        await server.connected;
        await retried;
        await opened;
        expect(c.state).toBe("open");
        c.close();
    });
});

describe("outbound queue", () => {
    const QURL = "ws://localhost:1241";
    let server: WS;

    afterEach(() => {
        WS.clean();
    });

    it("queues sends while connecting and flushes in order on open", async () => {
        server = new WS(QURL);
        const c = client({ url: QURL, reconnect: false });

        const opened = c.connect();
        c.send("first");
        c.send({ n: 2 });
        expect(c.state).toBe("connecting");
        expect(c.getState().queueLength).toBe(2);

        await server.connected;
        await opened;

        await expect(server).toReceiveMessage("first");
        await expect(server).toReceiveMessage(JSON.stringify({ n: 2 }));
        expect(c.getState().queueLength).toBe(0);
        c.close();
    });

    it("queues sends while reconnecting and flushes after recovery", async () => {
        server = new WS(QURL);
        const c = client({
            url: QURL,
            reconnect: { baseDelay: 10, jitter: false }
        });
        const opened = c.connect();
        await server.connected;
        await opened;

        server.close();
        await vi.waitFor(() => expect(c.state).toBe("reconnecting"));
        c.send("while-down");
        expect(c.getState().queueLength).toBe(1);

        WS.clean();
        server = new WS(QURL);
        await vi.waitFor(() => expect(c.state).toBe("open"), {
            timeout: 2000
        });
        await expect(server).toReceiveMessage("while-down");
        expect(c.getState().queueLength).toBe(0);
        c.close();
    });

    it("drops the oldest message on overflow, with a drop event", async () => {
        server = new WS(QURL);
        const c = client({
            url: QURL,
            reconnect: false,
            queue: { maxSize: 2 }
        });
        const drops = vi.fn();
        c.on("drop", drops);

        const opened = c.connect();
        c.send("a");
        c.send("b");
        c.send("c"); // overflows: "a" is dropped

        expect(drops).toHaveBeenCalledWith({ data: "a", reason: "overflow" });
        expect(c.getState().queueLength).toBe(2);

        await server.connected;
        await opened;
        await expect(server).toReceiveMessage("b");
        await expect(server).toReceiveMessage("c");
        c.close();
    });

    it("queue: false restores throw-when-not-open", async () => {
        server = new WS(QURL);
        const c = client({ url: QURL, reconnect: false, queue: false });
        c.connect().catch(() => {});
        expect(c.state).toBe("connecting");
        expect(() => c.send("nope")).toThrow(/not open/);
        c.close();
    });

    it("still throws when idle — no open is coming", () => {
        const c = client({ url: QURL });
        expect(() => c.send("nope")).toThrow(/not open/);
    });

    it("user close() drops queued messages as drop events", async () => {
        server = new WS(QURL);
        const c = client({ url: QURL, reconnect: false });
        const drops = vi.fn();
        c.on("drop", drops);

        c.connect().catch(() => {});
        c.send("never-sent");
        expect(c.getState().queueLength).toBe(1);

        c.close();
        expect(drops).toHaveBeenCalledWith({
            data: "never-sent",
            reason: "close"
        });
        expect(c.getState().queueLength).toBe(0);
    });

    it("terminal failure drops queued messages as drop events", async () => {
        // No server: retries exhaust, the close is terminal.
        const c = client({
            url: QURL,
            reconnect: { baseDelay: 5, jitter: false, maxRetries: 1 }
        });
        const drops = vi.fn();
        c.on("drop", drops);

        // Queue synchronously the moment the (only) retry is scheduled — the
        // reconnecting window is too brief to poll for.
        c.on("reconnecting", ({ attempt }) => {
            if (attempt === 1) {
                c.send("doomed");
            }
        });

        const opened = c.connect();
        await expect(opened).rejects.toThrow(/gave up/);
        expect(c.state).toBe("closed");
        expect(drops).toHaveBeenCalledWith({
            data: "doomed",
            reason: "close"
        });
        expect(c.getState().queueLength).toBe(0);
    });
});

describe("heartbeat", () => {
    const HURL = "ws://localhost:1242";
    let server: WS;

    afterEach(() => {
        WS.clean();
    });

    async function open(c: WebSocketClient) {
        const opened = c.connect();
        await server.connected;
        await opened;
    }

    it("sends the heartbeat message every interval while open", async () => {
        server = new WS(HURL);
        const c = client({
            url: HURL,
            reconnect: false,
            heartbeat: { interval: 25, timeout: 60_000 }
        });
        await open(c);

        await expect(server).toReceiveMessage("ping");
        await expect(server).toReceiveMessage("ping");
        c.close();
    });

    it("encodes a custom heartbeat message through the codec", async () => {
        server = new WS(HURL);
        const c = client({
            url: HURL,
            reconnect: false,
            heartbeat: {
                interval: 25,
                message: { type: "hb" },
                timeout: 60_000
            }
        });
        await open(c);

        await expect(server).toReceiveMessage(JSON.stringify({ type: "hb" }));
        c.close();
    });

    it("stays open while inbound traffic answers the pings", async () => {
        server = new WS(HURL);
        const c = client({
            url: HURL,
            reconnect: false,
            heartbeat: { interval: 20, timeout: 40 }
        });
        await open(c);

        // Answer each ping like a live server would.
        server.on("message", () => server.send("pong"));

        await new Promise((r) => setTimeout(r, 120));
        expect(c.state).toBe("open");
        c.close();
    });

    it("declares a silent link dead: error + close(4408) + reconnecting", async () => {
        server = new WS(HURL);
        const c = client({
            url: HURL,
            reconnect: { baseDelay: 60_000, jitter: false },
            heartbeat: { interval: 20, timeout: 15 }
        });
        const errors = vi.fn();
        const closes = vi.fn();
        c.on("error", errors);
        c.on("close", closes);
        await open(c);

        // Server never responds: the deadline after the first ping must fire.
        await vi.waitFor(() => expect(c.state).toBe("reconnecting"), {
            timeout: 2000
        });

        expect(errors).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringMatching(/heartbeat timeout/i)
            })
        );
        expect(closes).toHaveBeenCalledWith(
            expect.objectContaining({ code: 4408 })
        );
        expect(c.getState().lastError).toBeInstanceOf(Error);
        c.close();
    });

    it("does not ping when heartbeat is not configured", async () => {
        server = new WS(HURL);
        const c = client({ url: HURL, reconnect: false });
        await open(c);

        await new Promise((r) => setTimeout(r, 80));
        expect(server.messages).toEqual([]);
        c.close();
    });

    it("stops pinging after a user close()", async () => {
        server = new WS(HURL);
        const c = client({
            url: HURL,
            reconnect: false,
            heartbeat: { interval: 20, timeout: 60_000 }
        });
        await open(c);
        await expect(server).toReceiveMessage("ping");

        c.close();
        await server.closed;
        const sentSoFar = server.messages.length;

        await new Promise((r) => setTimeout(r, 60));
        expect(server.messages.length).toBe(sentSoFar);
    });
});

describe("schema validation", () => {
    const SURL = "ws://localhost:1243";
    let server: WS;

    afterEach(() => {
        WS.clean();
    });

    /** A minimal Standard Schema: object with a numeric `n`, else issues. */
    const nSchema = {
        "~standard": {
            version: 1 as const,
            vendor: "durablews-tests",
            validate: (value: unknown) => {
                const ok =
                    typeof value === "object" &&
                    value !== null &&
                    typeof (value as { n?: unknown }).n === "number";
                return ok
                    ? { value: value as { n: number } }
                    : { issues: [{ message: "expected { n: number }" }] };
            }
        }
    };

    async function open(c: WebSocketClient) {
        const opened = c.connect();
        await server.connected;
        await opened;
    }

    it("emits valid messages with the schema's output value", async () => {
        server = new WS(SURL);
        const c = client({ url: SURL, reconnect: false, schema: nSchema });
        const onMessage = vi.fn();
        c.on("message", onMessage);
        await open(c);

        server.send(JSON.stringify({ n: 7 }));

        expect(onMessage).toHaveBeenCalledWith({ n: 7 });
        c.close();
    });

    it("surfaces invalid messages as SchemaValidationError, never as message", async () => {
        server = new WS(SURL);
        const c = client({ url: SURL, reconnect: false, schema: nSchema });
        const onMessage = vi.fn();
        const onError = vi.fn();
        c.on("message", onMessage);
        c.on("error", onError);
        await open(c);

        server.send(JSON.stringify({ wrong: true }));

        expect(onMessage).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledTimes(1);
        const error = onError.mock.calls[0][0];
        expect(error).toBeInstanceOf(SchemaValidationError);
        expect((error as SchemaValidationError).issues).toEqual([
            { message: "expected { n: number }" }
        ]);
        c.close();
    });

    it("validation runs before middleware: invalid data never reaches it", async () => {
        server = new WS(SURL);
        const c = client({ url: SURL, reconnect: false, schema: nSchema });
        const sawMiddleware = vi.fn();
        c.use((_ctx, next) => {
            sawMiddleware();
            return next();
        });
        await open(c);

        server.send(JSON.stringify({ wrong: true }));
        expect(sawMiddleware).not.toHaveBeenCalled();

        server.send(JSON.stringify({ n: 1 }));
        expect(sawMiddleware).toHaveBeenCalledTimes(1);
        c.close();
    });

    it("supports async validate()", async () => {
        server = new WS(SURL);
        const asyncSchema = {
            "~standard": {
                version: 1 as const,
                vendor: "durablews-tests",
                validate: async (value: unknown) => {
                    await Promise.resolve();
                    return typeof value === "number"
                        ? { value }
                        : { issues: [{ message: "not a number" }] };
                }
            }
        };
        const c = client({ url: SURL, reconnect: false, schema: asyncSchema });
        const onMessage = vi.fn();
        const onError = vi.fn();
        c.on("message", onMessage);
        c.on("error", onError);
        await open(c);

        server.send("42"); // JSON-decodes to the number 42
        server.send(JSON.stringify({ nope: true }));
        await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));

        expect(onMessage).toHaveBeenCalledWith(42);
        expect(onError.mock.calls[0][0]).toBeInstanceOf(SchemaValidationError);
        c.close();
    });

    it("a validate() that throws surfaces as an error event", async () => {
        server = new WS(SURL);
        const throwingSchema = {
            "~standard": {
                version: 1 as const,
                vendor: "durablews-tests",
                validate: () => {
                    throw new Error("validator exploded");
                }
            }
        };
        const c = client({
            url: SURL,
            reconnect: false,
            schema: throwingSchema
        });
        const onError = vi.fn();
        c.on("error", onError);
        await open(c);

        server.send("1");

        expect(onError).toHaveBeenCalledWith(
            expect.objectContaining({ message: "validator exploded" })
        );
        c.close();
    });
});

describe("subscribe / snapshot", () => {
    const BURL = "ws://localhost:1244";
    let server: WS;

    afterEach(() => {
        WS.clean();
    });

    async function open(c: WebSocketClient) {
        const opened = c.connect();
        await server.connected;
        await opened;
    }

    it("getState() is referentially stable until something changes", async () => {
        server = new WS(BURL);
        const c = client({ url: BURL, reconnect: false });

        const a = c.getState();
        const b = c.getState();
        expect(b).toBe(a); // same frozen object — useSyncExternalStore-safe

        await open(c);
        const after = c.getState();
        expect(after).not.toBe(a);
        expect(after).toBe(c.getState());
        expect(after.state).toBe("open");
        c.close();
    });

    it("fires on connection state changes", async () => {
        server = new WS(BURL);
        const c = client({ url: BURL, reconnect: false });
        const listener = vi.fn();
        c.subscribe(listener);

        await open(c);
        // connecting + open — at least two notifications.
        expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
        c.close();
    });

    it("fires on queue growth, which is NOT an FSM transition", async () => {
        server = new WS(BURL);
        const c = client({ url: BURL, reconnect: false });
        c.connect().catch(() => {});

        const listener = vi.fn();
        c.subscribe(listener);
        const before = c.getState();
        expect(before.queueLength).toBe(0);

        c.send("queued-while-connecting");

        expect(listener).toHaveBeenCalledTimes(1);
        const after = c.getState();
        expect(after).not.toBe(before);
        expect(after.queueLength).toBe(1);
        c.close();
    });

    it("fires when a transport error records lastError", async () => {
        server = new WS(BURL);
        const c = client({ url: BURL, reconnect: false });
        await open(c);

        const listener = vi.fn();
        c.subscribe(listener);
        server.error();

        expect(listener).toHaveBeenCalled();
        expect(c.getState().lastError).not.toBeNull();
    });

    it("unsubscribe stops notifications", async () => {
        server = new WS(BURL);
        const c = client({ url: BURL, reconnect: false });
        const listener = vi.fn();
        const unsubscribe = c.subscribe(listener);
        unsubscribe();

        await open(c);
        expect(listener).not.toHaveBeenCalled();
        c.close();
    });

    it("listeners read a fresh snapshot from inside the notification", async () => {
        server = new WS(BURL);
        const c = client({ url: BURL, reconnect: false });
        const seen: string[] = [];
        c.subscribe(() => {
            seen.push(c.getState().state);
        });

        await open(c);
        expect(seen).toContain("connecting");
        expect(seen).toContain("open");
        c.close();
    });
});

describe("outbound middleware", () => {
    const OURL = "ws://localhost:1243";
    let server: WS;

    afterEach(() => {
        WS.clean();
    });

    async function open(c: WebSocketClient) {
        const opened = c.connect();
        await server.connected;
        await opened;
    }

    /** A promise with its resolver exposed, for holding middleware mid-flight. */
    function deferred() {
        let resolve!: () => void;
        const promise = new Promise<void>((res) => {
            resolve = res;
        });
        return { promise, resolve };
    }

    it("the object form registers inbound middleware too", async () => {
        server = new WS(OURL);
        const c = client({ url: OURL, reconnect: false });
        c.use({
            inbound: (ctx, next) => {
                ctx.data = `in:${String(ctx.data)}`;
                return next();
            }
        });
        const received: unknown[] = [];
        c.on("message", (msg) => received.push(msg));
        await open(c);

        server.send(JSON.stringify("hello"));
        await vi.waitFor(() => expect(received).toEqual(["in:hello"]));
        c.close();
    });

    it("transforms outgoing messages before encode", async () => {
        server = new WS(OURL);
        const c = client({ url: OURL, reconnect: false });
        c.use({
            outbound: (ctx, next) => {
                ctx.data = { body: ctx.data, token: "t-1" };
                return next();
            }
        });
        await open(c);

        c.send("hi");
        await expect(server).toReceiveMessage(
            JSON.stringify({ body: "hi", token: "t-1" })
        );
        c.close();
    });

    it("preserves send() order across async middleware", async () => {
        server = new WS(OURL);
        const c = client({ url: OURL, reconnect: false });
        const gate = deferred();
        let held = false;
        c.use({
            outbound: async (_ctx, next) => {
                if (!held) {
                    held = true;
                    await gate.promise; // first message stalls in-flight
                }
                await next();
            }
        });
        await open(c);

        c.send("first");
        c.send("second");
        gate.resolve();

        await expect(server).toReceiveMessage("first");
        await expect(server).toReceiveMessage("second");
        c.close();
    });

    it("short-circuit means deliberately not sent: no drop event", async () => {
        server = new WS(OURL);
        const c = client({ url: OURL, reconnect: false });
        const onDrop = vi.fn();
        c.on("drop", onDrop);
        c.use({
            outbound: (ctx, next) => {
                if (ctx.data === "secret") {
                    return; // policy: filtered, not lost
                }
                return next();
            }
        });
        await open(c);

        c.send("secret");
        c.send("public");
        await expect(server).toReceiveMessage("public");
        expect(onDrop).not.toHaveBeenCalled();
        c.close();
    });

    it("a throwing middleware fails only that message", async () => {
        server = new WS(OURL);
        const c = client({ url: OURL, reconnect: false });
        const errors: unknown[] = [];
        c.on("error", (e) => errors.push(e));
        c.use({
            outbound: (ctx, next) => {
                if (ctx.data === "boom") {
                    throw new Error("outbound failed");
                }
                return next();
            }
        });
        await open(c);

        c.send("boom");
        c.send("fine");
        await expect(server).toReceiveMessage("fine");
        expect(errors).toHaveLength(1);
        expect((errors[0] as Error).message).toMatch(/outbound failed/);
        c.close();
    });

    it("runs at transmission time, not send() time (queued messages)", async () => {
        server = new WS(OURL);
        const c = client({ url: OURL, reconnect: false });
        const ran = vi.fn();
        c.use({
            outbound: (ctx, next) => {
                ran();
                ctx.data = `stamped:${String(ctx.data)}`;
                return next();
            }
        });

        const opened = c.connect();
        c.send("early"); // still connecting → queued
        expect(ran).not.toHaveBeenCalled(); // not at send() time

        await server.connected;
        await opened;
        await expect(server).toReceiveMessage("stamped:early");
        expect(ran).toHaveBeenCalledTimes(1);
        c.close();
    });

    it("heartbeat pings bypass outbound middleware", async () => {
        vi.useFakeTimers();
        try {
            server = new WS(OURL);
            const c = client({
                url: OURL,
                reconnect: false,
                heartbeat: { interval: 50 }
            });
            const ran = vi.fn();
            c.use({
                outbound: (_ctx, next) => {
                    ran();
                    return next();
                }
            });

            const opened = c.connect();
            await vi.waitFor(async () => {
                await server.connected;
            });
            await opened;

            await vi.advanceTimersByTimeAsync(60); // one ping goes out
            expect(ran).not.toHaveBeenCalled();
            c.close();
        } finally {
            vi.useRealTimers();
        }
    });

    it("re-queues a message whose connection dropped mid-pipeline", async () => {
        server = new WS(OURL);
        const c = client({
            url: OURL,
            reconnect: { baseDelay: 30_000, jitter: false }
        });
        const gate = deferred();
        c.use({
            outbound: async (_ctx, next) => {
                await gate.promise;
                await next();
            }
        });
        await open(c);

        c.send("in-flight");
        server.close(); // unexpected close → reconnecting (long backoff)
        await vi.waitFor(() => expect(c.state).toBe("reconnecting"));

        gate.resolve(); // pipeline finishes with no open socket
        await vi.waitFor(() => {
            expect(c.getState().queueLength).toBe(1);
        });
        c.close();
    });

    it("drops (never silently loses) a mid-pipeline message on user close()", async () => {
        server = new WS(OURL);
        const c = client({ url: OURL, reconnect: false });
        const drops: unknown[] = [];
        c.on("drop", (d) => drops.push(d));
        const gate = deferred();
        c.use({
            outbound: async (_ctx, next) => {
                await gate.promise;
                await next();
            }
        });
        await open(c);

        c.send("in-flight");
        c.close();
        gate.resolve();
        await vi.waitFor(() => {
            expect(drops).toEqual([{ data: "in-flight", reason: "close" }]);
        });
    });
});
