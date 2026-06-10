import { act, renderHook, waitFor } from "@testing-library/react";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    expectTypeOf,
    it
} from "vitest";
import WS from "vitest-websocket-mock";
import { client } from "../src/client";
import { useWebSocket } from "../src/react";
import type { StandardSchemaV1 } from "../src/schema";

// React requires this flag for act() in non-react-dom/test-utils environments.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const URL = "ws://localhost:1234";

describe("react useWebSocket", () => {
    let server: WS;

    beforeEach(() => {
        server = new WS(URL);
    });

    afterEach(() => {
        WS.clean();
    });

    it("owns a client created from a config: auto-connects and tracks state", async () => {
        const { result, unmount } = renderHook(() =>
            useWebSocket({ url: URL, reconnect: false })
        );

        expect(result.current.state).toBe("connecting");
        await act(async () => {
            await server.connected;
        });
        await waitFor(() => {
            expect(result.current.state).toBe("open");
        });
        unmount();
    });

    it("exposes the latest inbound message", async () => {
        const { result, unmount } = renderHook(() =>
            useWebSocket({ url: URL, reconnect: false })
        );
        await act(async () => {
            await server.connected;
        });

        expect(result.current.lastMessage).toBeUndefined();
        await act(async () => {
            server.send(JSON.stringify({ type: "chat", body: "hi" }));
        });
        await waitFor(() => {
            expect(result.current.lastMessage).toEqual({
                type: "chat",
                body: "hi"
            });
        });
        unmount();
    });

    it("send() proxies to the client (queueing while connecting)", async () => {
        const { result, unmount } = renderHook(() =>
            useWebSocket({ url: URL, reconnect: false })
        );

        // Still connecting: the message queues and the snapshot reflects it.
        act(() => {
            result.current.send("early");
        });
        expect(result.current.queueLength).toBe(1);

        await act(async () => {
            await server.connected;
        });
        await expect(server).toReceiveMessage("early");
        await waitFor(() => {
            expect(result.current.queueLength).toBe(0);
        });
        unmount();
    });

    it("keeps the same client across re-renders", async () => {
        const { result, rerender, unmount } = renderHook(() =>
            useWebSocket({ url: URL, reconnect: false })
        );
        const first = result.current.client;
        rerender();
        expect(result.current.client).toBe(first);
        await act(async () => {
            await server.connected;
        });
        unmount();
    });

    it("closes an owned client on unmount", async () => {
        const { result, unmount } = renderHook(() =>
            useWebSocket({ url: URL, reconnect: false })
        );
        await act(async () => {
            await server.connected;
        });
        await waitFor(() => {
            expect(result.current.state).toBe("open");
        });

        const owned = result.current.client;
        unmount();
        await waitFor(() => {
            expect(owned.state).toBe("closed");
        });
    });

    it("borrows an existing client: never connects or closes it", async () => {
        const core = client({ url: URL, reconnect: false });
        const opened = core.connect();
        await act(async () => {
            await server.connected;
        });
        await opened;

        const { result, unmount } = renderHook(() => useWebSocket(core));
        expect(result.current.client).toBe(core);
        expect(result.current.state).toBe("open");

        unmount();
        expect(core.state).toBe("open");
    });

    it("infers the message type from a schema (compile-time)", async () => {
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
        const { result, unmount } = renderHook(() =>
            useWebSocket({ url: URL, reconnect: false, schema: chatSchema })
        );
        expectTypeOf(result.current.lastMessage).toEqualTypeOf<
            Chat | undefined
        >();
        await act(async () => {
            await server.connected;
        });
        unmount();
    });
});
