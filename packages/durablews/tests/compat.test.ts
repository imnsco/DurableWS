import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WS from "vitest-websocket-mock";
import { WebSocket as CompatWS, DurableWebSocket } from "../src/compat";

const URL = "ws://localhost:1245";

describe("durablews/compat", () => {
    let server: WS;

    beforeEach(() => {
        server = new WS(URL);
    });

    afterEach(() => {
        WS.clean();
    });

    function makeSocket(options = {}) {
        return new DurableWebSocket(URL, undefined, {
            reconnect: false,
            ...options
        });
    }

    it("exposes the native constants, statically and per instance", () => {
        expect(DurableWebSocket.CONNECTING).toBe(0);
        expect(DurableWebSocket.OPEN).toBe(1);
        expect(DurableWebSocket.CLOSING).toBe(2);
        expect(DurableWebSocket.CLOSED).toBe(3);
        const ws = makeSocket();
        expect(ws.CONNECTING).toBe(0);
        expect(ws.OPEN).toBe(1);
        expect(ws.CLOSING).toBe(2);
        expect(ws.CLOSED).toBe(3);
        ws.close();
    });

    it("is exported under the WebSocket alias", () => {
        expect(CompatWS).toBe(DurableWebSocket);
    });

    it("connects on construction and fires open both ways", async () => {
        const ws = makeSocket();
        expect(ws.readyState).toBe(DurableWebSocket.CONNECTING);

        const viaProp = vi.fn();
        const viaListener = vi.fn();
        ws.onopen = viaProp;
        ws.addEventListener("open", viaListener);

        await server.connected;
        await vi.waitFor(() => {
            expect(ws.readyState).toBe(DurableWebSocket.OPEN);
        });
        expect(viaProp).toHaveBeenCalledTimes(1);
        expect(viaListener).toHaveBeenCalledTimes(1);
        expect(viaProp.mock.calls[0][0]).toBeInstanceOf(Event);
        ws.close();
    });

    it("is wire-faithful: no JSON codec in either direction", async () => {
        const ws = makeSocket();
        const received: unknown[] = [];
        ws.onmessage = (event) => received.push(event.data);
        await server.connected;

        ws.send('{"already":"json"}');
        await expect(server).toReceiveMessage('{"already":"json"}');

        server.send('{"type":"chat"}');
        await vi.waitFor(() => {
            // The raw string — not a parsed object.
            expect(received).toEqual(['{"type":"chat"}']);
        });
        ws.close();
    });

    it("queues sends while connecting and flushes on open", async () => {
        const ws = makeSocket();
        ws.send("early"); // native would throw InvalidStateError; we queue
        await server.connected;
        await expect(server).toReceiveMessage("early");
        ws.close();
    });

    it("close() walks CLOSING → CLOSED and fires a CloseEvent", async () => {
        const ws = makeSocket();
        await server.connected;
        await vi.waitFor(() => {
            expect(ws.readyState).toBe(DurableWebSocket.OPEN);
        });

        const closes: CloseEvent[] = [];
        ws.onclose = (event) => closes.push(event);
        ws.close();
        expect(ws.readyState).toBe(DurableWebSocket.CLOSING);
        await vi.waitFor(() => {
            expect(ws.readyState).toBe(DurableWebSocket.CLOSED);
        });
        expect(closes).toHaveLength(1);
        expect(typeof closes[0].code).toBe("number");
    });

    it("send after close is silently discarded (native fidelity)", async () => {
        const ws = makeSocket();
        await server.connected;
        ws.close();
        await vi.waitFor(() => {
            expect(ws.readyState).toBe(DurableWebSocket.CLOSED);
        });
        expect(() => ws.send("late")).not.toThrow();
    });

    it("readyState returns to CONNECTING during automatic reconnection", async () => {
        const ws = new DurableWebSocket(URL, undefined, {
            reconnect: { baseDelay: 30_000, jitter: false }
        });
        await server.connected;
        await vi.waitFor(() => {
            expect(ws.readyState).toBe(DurableWebSocket.OPEN);
        });

        server.close(); // unexpected → reconnecting (long backoff)
        await vi.waitFor(() => {
            expect(ws.client.state).toBe("reconnecting");
        });
        // The documented deviation: a native socket can never do this.
        expect(ws.readyState).toBe(DurableWebSocket.CONNECTING);
        ws.close();
    });

    it("recovers transparently and keeps delivering", async () => {
        const ws = new DurableWebSocket(URL, undefined, {
            reconnect: { baseDelay: 10, jitter: false }
        });
        const received: unknown[] = [];
        ws.addEventListener("message", (event) => {
            received.push((event as MessageEvent).data);
        });
        await server.connected;

        server.close();
        WS.clean();
        server = new WS(URL);

        await vi.waitFor(
            () => {
                expect(ws.readyState).toBe(DurableWebSocket.OPEN);
            },
            { timeout: 2000 }
        );
        server.send("after-recovery");
        await vi.waitFor(() => {
            expect(received).toEqual(["after-recovery"]);
        });
        ws.close();
    });

    it("exposes the underlying client as the escape hatch", async () => {
        const ws = makeSocket();
        expect(ws.client.state).toBe("connecting");
        await server.connected;
        await vi.waitFor(() => {
            expect(ws.client.getState().state).toBe("open");
        });
        ws.close();
    });

    it("converts Blob frames when binaryType is set after construction", async () => {
        const ws = makeSocket();
        ws.binaryType = "arraybuffer";
        expect(ws.binaryType).toBe("arraybuffer");
        const received: unknown[] = [];
        ws.onmessage = (event) => received.push(event.data);
        await server.connected;

        const blob = new Blob(["bytes"]);
        server.send(blob as unknown as string);
        await vi.waitFor(() => {
            expect(received).toHaveLength(1);
        });
        expect(received[0]).toBeInstanceOf(ArrayBuffer);
        ws.close();
    });
});
