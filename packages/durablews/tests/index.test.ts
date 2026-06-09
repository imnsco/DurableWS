import { describe, expect, it } from "vitest";
import { defineClient } from "../src/index";

describe("defineClient", () => {
    it("creates a client", () => {
        const ws = defineClient({ url: "ws://localhost:1234" });
        expect(ws).toBeDefined();
        expect(ws.connect).toBeTypeOf("function");
        expect(ws.state).toBe("idle");
    });

    it("returns an independent instance on each call (no singleton)", () => {
        const a = defineClient({ url: "ws://localhost:1234" });
        const b = defineClient({ url: "ws://localhost:1235" });
        expect(a).not.toBe(b);
    });
});
