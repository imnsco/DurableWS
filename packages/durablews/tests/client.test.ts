import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// https://github.com/akiomik/vitest-websocket-mock
import WS from "vitest-websocket-mock";
import { client } from "../src/client";
import type { WebSocketClient } from "../src/types";

const URL = "ws://localhost:1234";

describe("client", () => {
    let server: WS;
    let ws: WebSocketClient;

    beforeEach(() => {
        server = new WS(URL);
        ws = client({ url: URL });
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
        const custom = client({ url: customUrl, codec });

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
});
