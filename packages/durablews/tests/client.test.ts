import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// https://github.com/akiomik/vitest-websocket-mock
import WS from "vitest-websocket-mock";
import { client } from "../src/client";
import { pingpong } from "../src/middleware";
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
            retryAttempt: 0
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
