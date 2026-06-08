import { beforeEach, describe, expect, it } from "vitest";
import { defineClient } from "../src/index";
import type { WebSocketClient } from "../src/types";

describe("Index", () => {
    let client: WebSocketClient;
    beforeEach(() => {
        client = defineClient({ url: "ws://localhost:1234" });
    });
    it("should define a client", () => {
        expect(client).toBeDefined();
    });

    it("should return the same client instance", () => {
        const client2 = defineClient({ url: "ws://localhost:1235" });
        expect(client).toBe(client2);
    });
});
