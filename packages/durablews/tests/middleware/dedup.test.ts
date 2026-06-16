import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// https://github.com/akiomik/vitest-websocket-mock
import WS from "vitest-websocket-mock";
import { client } from "../../src/client";
import { dedup } from "../../src/middleware/dedup";
import type { WebSocketClient } from "../../src/types";

const URL = "ws://localhost:1234";

describe("dedup middleware", () => {
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

    it("drops a redelivered message with the same key", async () => {
        const onMessage = vi.fn();
        const ws = client({ url: URL, reconnect: false });
        ws.use(dedup({ key: (m) => (m as { id: string }).id }));
        ws.on("message", onMessage);
        await open(ws);

        server.send(JSON.stringify({ id: "a", n: 1 }));
        server.send(JSON.stringify({ id: "a", n: 1 })); // duplicate
        server.send(JSON.stringify({ id: "b", n: 2 })); // distinct

        expect(onMessage).toHaveBeenCalledTimes(2);
        expect(onMessage).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ id: "a" })
        );
        expect(onMessage).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ id: "b" })
        );
        ws.close();
    });

    it("forgets keys beyond the bounded window (drop-oldest)", async () => {
        const onMessage = vi.fn();
        const ws = client({ url: URL, reconnect: false });
        ws.use(dedup({ key: (m) => (m as { id: string }).id, window: 2 }));
        ws.on("message", onMessage);
        await open(ws);

        server.send(JSON.stringify({ id: "a" }));
        server.send(JSON.stringify({ id: "b" }));
        server.send(JSON.stringify({ id: "c" })); // evicts "a"
        server.send(JSON.stringify({ id: "a" })); // no longer remembered: passes

        expect(onMessage).toHaveBeenCalledTimes(4);
        ws.close();
    });
});
