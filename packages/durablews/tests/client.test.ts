import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// https://github.com/akiomik/vitest-websocket-mock
import WS from "vitest-websocket-mock";
import { client } from "../src/client";
import { pingpong } from "../src/middleware/pingpong";
import type { WebSocketClient } from "../src/types";

const WEBSOCKET_URL = "ws://localhost:1234";

// Helper: Wait for a given amount of milliseconds
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Client", () => {
    let server: WS;
    let wsClient: WebSocketClient;

    beforeEach(async () => {
        server = new WS(WEBSOCKET_URL);
        wsClient = client({
            url: WEBSOCKET_URL
        });
        wsClient.connect();
        await server.connected;
    });

    afterEach(() => {
        WS.clean();
    });

    it("should return a client instance", async () => {
        expect(wsClient).toBeDefined();
        expect(wsClient.connect).toBeDefined();
    });

    it("should close the connection", async () => {
        wsClient.close();
        await server.closed;
        expect(server).toHaveReceivedMessages([]);
    });

    it("should send a message", async () => {
        const message = { type: "test", payload: "hello" };
        wsClient.send(message);

        await expect(server).toReceiveMessage(JSON.stringify(message));
        expect(server).toHaveReceivedMessages([JSON.stringify(message)]);
    });

    it("should handle incoming messages", async () => {
        const messageHandler = vi.fn();
        wsClient.on("message", messageHandler);

        server.send(JSON.stringify({ data: "test message" }));
        // Wait for the message to be processed
        await wait(100);

        expect(messageHandler).toHaveBeenCalledWith(
            expect.objectContaining({
                data: "test message"
            })
        );
    });

    it("should handle connection close", async () => {
        const closeHandler = vi.fn();
        wsClient.on("close", closeHandler);

        server.close();
        // Wait for the close event to be processed
        await wait(100);

        expect(closeHandler).toHaveBeenCalled();
    });

    it("should handle errors", async () => {
        const errorHandler = vi.fn();
        wsClient.on("error", errorHandler);

        server.error();
        // Wait for the error event to be processed
        await wait(100);

        expect(errorHandler).toHaveBeenCalled();
    });

    // it should handle pingpong middleware
    it("should handle pingpong middleware", async () => {
        server.send("ping");
        wsClient.use(pingpong);
        await expect(server).toReceiveMessage("pong");
    });
});
