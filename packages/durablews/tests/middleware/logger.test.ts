import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// https://github.com/akiomik/vitest-websocket-mock
import WS from "vitest-websocket-mock";
import { client } from "../../src/client";
import { type LogEntry, logger } from "../../src/middleware/logger";
import type { WebSocketClient } from "../../src/types";

const URL = "ws://localhost:1234";

describe("logger middleware", () => {
    let server: WS;

    beforeEach(() => {
        server = new WS(URL);
    });

    afterEach(() => {
        WS.clean();
    });

    async function open(ws: WebSocketClient<unknown, unknown>) {
        const opened = ws.connect();
        await server.connected;
        await opened;
    }

    it("logs outbound and inbound messages with direction, state, timestamp", async () => {
        const entries: LogEntry[] = [];
        const ws = client({ url: URL, reconnect: false });
        ws.use(logger({ log: (e) => entries.push(e) }));
        await open(ws);

        ws.send({ hello: "world" });
        await expect(server).toReceiveMessage(
            JSON.stringify({ hello: "world" })
        );
        server.send(JSON.stringify({ pong: true }));

        const outbound = entries.find((e) => e.direction === "outbound");
        const inbound = entries.find((e) => e.direction === "inbound");
        expect(outbound?.data).toEqual({ hello: "world" });
        expect(inbound?.data).toEqual({ pong: true });
        expect(outbound?.state).toBe("open");
        expect(typeof outbound?.timestamp).toBe("number");
        ws.close();
    });

    it("redacts before logging without altering the wire or handlers", async () => {
        const entries: LogEntry[] = [];
        const onMessage = vi.fn();
        const ws = client({ url: URL, reconnect: false });
        ws.use(
            logger({
                log: (e) => entries.push(e),
                redact: (data) => ({
                    ...(data as Record<string, unknown>),
                    token: "[redacted]"
                })
            })
        );
        ws.on("message", onMessage);
        await open(ws);

        ws.send({ token: "secret-abc" });
        // The wire sees the real value, not the redacted one.
        await expect(server).toReceiveMessage(
            JSON.stringify({ token: "secret-abc" })
        );

        server.send(JSON.stringify({ token: "secret-xyz" }));
        // The handler sees the real value too.
        expect(onMessage).toHaveBeenCalledWith(
            expect.objectContaining({ token: "secret-xyz" })
        );
        // Only the logs are scrubbed.
        expect(
            entries.every(
                (e) => (e.data as { token: string }).token === "[redacted]"
            )
        ).toBe(true);
        ws.close();
    });

    it("honors direction: outbound only", async () => {
        const entries: LogEntry[] = [];
        const ws = client({ url: URL, reconnect: false });
        ws.use(logger({ log: (e) => entries.push(e), direction: "outbound" }));
        await open(ws);

        ws.send({ a: 1 });
        await expect(server).toReceiveMessage(JSON.stringify({ a: 1 }));
        server.send(JSON.stringify({ b: 2 }));

        expect(entries.every((e) => e.direction === "outbound")).toBe(true);
        expect(entries).toHaveLength(1);
        ws.close();
    });
});
