import {
    afterEach,
    beforeEach,
    describe,
    expect,
    expectTypeOf,
    it,
    vi
} from "vitest";
import WS from "vitest-websocket-mock";
import { type ComputedRef, type EffectScope, effectScope } from "vue";
import { client } from "../src/client";
import type { StandardSchemaV1 } from "../src/schema";
import { useWebSocket } from "../src/vue";

const URL = "ws://localhost:1234";

describe("vue useWebSocket", () => {
    let server: WS;
    let scope: EffectScope;

    beforeEach(() => {
        server = new WS(URL);
        scope = effectScope();
    });

    afterEach(() => {
        scope.stop();
        WS.clean();
    });

    function inScope<T>(fn: () => T): T {
        const result = scope.run(fn);
        if (result === undefined) {
            throw new Error("scope.run returned undefined");
        }
        return result;
    }

    it("owns a client created from a config: auto-connects and tracks state reactively", async () => {
        const ws = inScope(() => useWebSocket({ url: URL, reconnect: false }));

        expect(ws.state.value).toBe("connecting");
        await server.connected;
        await vi.waitFor(() => {
            expect(ws.state.value).toBe("open");
        });
    });

    it("exposes the latest inbound message as a ref", async () => {
        const ws = inScope(() => useWebSocket({ url: URL, reconnect: false }));
        await server.connected;

        expect(ws.lastMessage.value).toBeUndefined();
        server.send(JSON.stringify({ type: "chat", body: "hi" }));
        await vi.waitFor(() => {
            expect(ws.lastMessage.value).toEqual({ type: "chat", body: "hi" });
        });
    });

    it("send() proxies to the client (queueing while connecting)", async () => {
        const ws = inScope(() => useWebSocket({ url: URL, reconnect: false }));

        // Still connecting: the message queues and the ref reflects it.
        ws.send("early");
        expect(ws.queueLength.value).toBe(1);

        await server.connected;
        await expect(server).toReceiveMessage("early");
        await vi.waitFor(() => {
            expect(ws.queueLength.value).toBe(0);
        });

        ws.send("late");
        await expect(server).toReceiveMessage("late");
    });

    it("closes an owned client when the scope is disposed", async () => {
        const ws = inScope(() => useWebSocket({ url: URL, reconnect: false }));
        await server.connected;
        await vi.waitFor(() => {
            expect(ws.state.value).toBe("open");
        });

        scope.stop();
        await vi.waitFor(() => {
            expect(ws.client.state).toBe("closed");
        });
    });

    it("borrows an existing client: never connects or closes it", async () => {
        const core = client({ url: URL, reconnect: false });
        const ws = inScope(() => useWebSocket(core));

        // Not auto-connected.
        expect(ws.client).toBe(core);
        expect(ws.state.value).toBe("idle");

        // Reactive once the app connects it.
        const opened = core.connect();
        await server.connected;
        await opened;
        expect(ws.state.value).toBe("open");

        // Disposal detaches the binding but leaves the client running.
        scope.stop();
        expect(core.state).toBe("open");
    });

    it("stops tracking after disposal", async () => {
        const core = client({ url: URL, reconnect: false });
        const ws = inScope(() => useWebSocket(core));
        scope.stop();

        const opened = core.connect();
        await server.connected;
        await opened;
        expect(ws.state.value).toBe("idle");

        server.send(JSON.stringify("ignored"));
        await vi.waitFor(() => {
            expect(core.state).toBe("open");
        });
        expect(ws.lastMessage.value).toBeUndefined();
    });

    it("infers the message type from a schema (compile-time)", () => {
        interface Chat {
            readonly body: string;
        }
        const chatSchema: StandardSchemaV1<unknown, Chat> = {
            "~standard": {
                version: 1,
                vendor: "durablews-tests",
                validate: (value) => ({ value: value as Chat })
            }
        };
        const ws = inScope(() =>
            useWebSocket({ url: URL, reconnect: false, schema: chatSchema })
        );
        expectTypeOf(ws.lastMessage.value).toEqualTypeOf<Chat | undefined>();
        expectTypeOf(ws.state).toMatchTypeOf<ComputedRef<string>>();
    });
});
