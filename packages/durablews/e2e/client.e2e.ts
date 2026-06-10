import { expect, test } from "@playwright/test";
// @ts-expect-error - plain .mjs test helper, no types needed
import { startEchoServer } from "./echo-server.mjs";

let server: { port: number; close: () => Promise<void> };

test.beforeAll(async () => {
    server = await startEchoServer();
});

test.afterAll(async () => {
    await server.close();
});

test("connects, round-trips a message, and closes against a real WebSocket", async ({
    page
}) => {
    await page.goto("/e2e/app.html");

    const result = await page.evaluate(async (wsUrl) => {
        // The built ESM bundle, loaded in a real browser over a real WebSocket.
        const { defineClient } = await import("/dist/index.js");
        const ws = defineClient({ url: wsUrl });
        const messages: unknown[] = [];
        ws.on("message", (m: unknown) => messages.push(m));

        await ws.connect();
        const openState = ws.state;
        ws.send({ hello: "world" });

        await new Promise((r) => setTimeout(r, 200));
        ws.close();
        await new Promise((r) => setTimeout(r, 100));

        return { openState, closedState: ws.state, messages };
    }, `ws://localhost:${server.port}`);

    expect(result.openState).toBe("open");
    expect(result.messages).toContainEqual({ hello: "world" });
    expect(result.closedState).toBe("closed");
});

test("reconnects after closing, against a real WebSocket", async ({ page }) => {
    await page.goto("/e2e/app.html");

    const result = await page.evaluate(async (wsUrl) => {
        const { defineClient } = await import("/dist/index.js");
        const ws = defineClient({ url: wsUrl });

        await ws.connect();
        ws.close();
        await new Promise((r) => setTimeout(r, 100));
        const afterClose = ws.state;

        await ws.connect();
        const afterReconnect = ws.state;

        const echoed: unknown[] = [];
        ws.on("message", (m: unknown) => echoed.push(m));
        ws.send("again");
        await new Promise((r) => setTimeout(r, 150));
        ws.close();

        return { afterClose, afterReconnect, echoed };
    }, `ws://localhost:${server.port}`);

    expect(result.afterClose).toBe("closed");
    expect(result.afterReconnect).toBe("open");
    expect(result.echoed).toContain("again");
});

test("transparently reconnects when the server drops the connection", async ({
    page
}) => {
    await page.goto("/e2e/app.html");

    const result = await page.evaluate(async (wsUrl) => {
        const { defineClient } = await import("/dist/index.js");
        const ws = defineClient({
            url: wsUrl,
            reconnect: { baseDelay: 50, jitter: false }
        });
        const states: string[] = [];
        ws.on("statechange", ({ current }: { current: string }) =>
            states.push(current)
        );
        const retries: number[] = [];
        ws.on("reconnecting", ({ attempt }: { attempt: number }) =>
            retries.push(attempt)
        );

        await ws.connect();
        ws.send("drop"); // the server closes this connection (code 1012)

        // Wait for the drop + automatic reconnect to play out.
        await new Promise((r) => setTimeout(r, 600));
        const recovered = ws.state;

        // Prove the recovered connection actually works.
        const echoed: unknown[] = [];
        ws.on("message", (m: unknown) => echoed.push(m));
        ws.send("after-reconnect");
        await new Promise((r) => setTimeout(r, 200));
        ws.close();

        return { states, retries, recovered, echoed };
    }, `ws://localhost:${server.port}`);

    expect(result.states).toContain("reconnecting");
    expect(result.retries).toContain(1);
    expect(result.recovered).toBe("open");
    expect(result.echoed).toContain("after-reconnect");
});

test("flushes messages queued while disconnected once reconnected", async ({
    page
}) => {
    await page.goto("/e2e/app.html");

    const result = await page.evaluate(async (wsUrl) => {
        const { defineClient } = await import("/dist/index.js");
        const ws = defineClient({
            url: wsUrl,
            reconnect: { baseDelay: 50, jitter: false }
        });
        const echoed: unknown[] = [];
        ws.on("message", (m: unknown) => echoed.push(m));

        await ws.connect();
        const droppedToReconnecting = new Promise<void>((resolve) => {
            ws.on("statechange", ({ current }: { current: string }) => {
                if (current === "reconnecting") {
                    resolve();
                }
            });
        });

        ws.send("drop"); // server closes this connection
        await droppedToReconnecting;

        ws.send("queued-while-down"); // no socket exists: this must queue
        const queuedLength = ws.getState().queueLength;

        await new Promise((r) => setTimeout(r, 600)); // reconnect + flush
        const finalState = ws.state;
        ws.close();

        return { queuedLength, echoed, finalState };
    }, `ws://localhost:${server.port}`);

    expect(result.queuedLength).toBe(1);
    expect(result.finalState).toBe("open");
    expect(result.echoed).toContain("queued-while-down");
});

test("heartbeat detects a silent link and recovers through reconnect", async ({
    page
}) => {
    await page.goto("/e2e/app.html");

    const result = await page.evaluate(async (wsUrl) => {
        const { defineClient } = await import("/dist/index.js");
        const ws = defineClient({
            url: wsUrl,
            reconnect: { baseDelay: 50, jitter: false },
            heartbeat: { interval: 100, timeout: 80 }
        });
        const states: string[] = [];
        ws.on("statechange", ({ current }: { current: string }) =>
            states.push(current)
        );
        const errors: string[] = [];
        ws.on("error", (e: unknown) => {
            if (e instanceof Error) {
                errors.push(e.message);
            }
        });
        const closeCodes: number[] = [];
        ws.on("close", (e: { code: number }) => closeCodes.push(e.code));

        await ws.connect();
        ws.send("mute"); // the server goes silent on this connection

        // Silent link: pings get no reply → 4408 close → reconnect lands on a
        // fresh, unmuted connection.
        await new Promise((r) => setTimeout(r, 800));
        const recovered = ws.state;

        const echoed: unknown[] = [];
        ws.on("message", (m: unknown) => echoed.push(m));
        ws.send("alive-again");
        await new Promise((r) => setTimeout(r, 200));
        ws.close();

        return { states, errors, closeCodes, recovered, echoed };
    }, `ws://localhost:${server.port}`);

    expect(result.errors.some((m) => /heartbeat timeout/i.test(m))).toBe(true);
    expect(result.closeCodes).toContain(4408);
    expect(result.states).toContain("reconnecting");
    expect(result.recovered).toBe("open");
    expect(result.echoed).toContain("alive-again");
});

test("outbound middleware stamps messages before they reach the wire", async ({
    page
}) => {
    await page.goto("/e2e/app.html");

    const result = await page.evaluate(async (wsUrl) => {
        const { defineClient } = await import("/dist/index.js");
        const ws = defineClient({ url: wsUrl });
        ws.use({
            outbound: async (
                ctx: { data: unknown },
                next: () => Promise<void> | undefined
            ) => {
                // Async on purpose: prove ordered async against a real socket.
                await new Promise((r) => setTimeout(r, 20));
                ctx.data = { body: ctx.data, token: "tok-123" };
                await next();
            }
        });
        const echoed: unknown[] = [];
        ws.on("message", (m: unknown) => echoed.push(m));

        await ws.connect();
        ws.send("one");
        ws.send("two");
        await new Promise((r) => setTimeout(r, 400));
        ws.close();

        return { echoed };
    }, `ws://localhost:${server.port}`);

    // The echo server reflects what actually hit the wire: stamped, in order.
    expect(result.echoed).toEqual([
        { body: "one", token: "tok-123" },
        { body: "two", token: "tok-123" }
    ]);
});
