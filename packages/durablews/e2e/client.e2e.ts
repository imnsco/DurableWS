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
