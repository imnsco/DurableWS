import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// https://github.com/akiomik/vitest-websocket-mock
import WS from "vitest-websocket-mock";
import { client } from "../../src/client";
import { auth } from "../../src/middleware/auth";
import type { WebSocketClient } from "../../src/types";

const URL = "ws://localhost:1234";

describe("auth middleware", () => {
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

    it("attaches a token to each outbound message", async () => {
        const ws: WebSocketClient<unknown, { type: string }> = client({
            url: URL,
            reconnect: false
        });
        ws.use(
            auth<{ type: string }>({
                token: () => "t0ken",
                inject: (data, token) => ({ ...data, token })
            })
        );
        await open(ws);

        ws.send({ type: "hi" });
        await expect(server).toReceiveMessage(
            JSON.stringify({ type: "hi", token: "t0ken" })
        );
        ws.close();
    });

    it("resolves the token at transmission time, fresh per message", async () => {
        const ws: WebSocketClient<unknown, { type: string }> = client({
            url: URL,
            reconnect: false
        });
        let n = 0;
        ws.use(
            auth<{ type: string }>({
                token: () => `t${n++}`,
                inject: (data, token) => ({ ...data, token })
            })
        );
        await open(ws);

        ws.send({ type: "a" });
        await expect(server).toReceiveMessage(
            JSON.stringify({ type: "a", token: "t0" })
        );
        ws.send({ type: "b" });
        await expect(server).toReceiveMessage(
            JSON.stringify({ type: "b", token: "t1" })
        );
        ws.close();
    });

    it("awaits an async token and preserves send order", async () => {
        const ws: WebSocketClient<unknown, { n: number }> = client({
            url: URL,
            reconnect: false
        });
        ws.use(
            auth<{ n: number }>({
                token: async () => "async-token",
                inject: (data, token) => ({ ...data, token })
            })
        );
        await open(ws);

        ws.send({ n: 1 });
        ws.send({ n: 2 });
        await expect(server).toReceiveMessage(
            JSON.stringify({ n: 1, token: "async-token" })
        );
        await expect(server).toReceiveMessage(
            JSON.stringify({ n: 2, token: "async-token" })
        );
        ws.close();
    });

    it("surfaces a token failure as an error and sends later messages", async () => {
        const ws: WebSocketClient<unknown, { n: number }> = client({
            url: URL,
            reconnect: false
        });
        let calls = 0;
        ws.use(
            auth<{ n: number }>({
                token: () => {
                    calls += 1;
                    if (calls === 1) {
                        throw new Error("refresh failed");
                    }
                    return "ok";
                },
                inject: (data, token) => ({ ...data, token })
            })
        );
        const onError = vi.fn();
        ws.on("error", onError);
        await open(ws);

        ws.send({ n: 1 }); // token throws: not sent, surfaces as error
        ws.send({ n: 2 }); // continues

        await expect(server).toReceiveMessage(
            JSON.stringify({ n: 2, token: "ok" })
        );
        expect(onError).toHaveBeenCalledTimes(1);
        ws.close();
    });
});
