import { describe, expect, it } from "vitest";
import { HEARTBEAT_TIMEOUT_CODE, resolveHeartbeat } from "../src/heartbeat";

describe("resolveHeartbeat", () => {
    it("is opt-in: undefined means off", () => {
        expect(resolveHeartbeat(undefined)).toBeNull();
    });

    it("defaults message to 'ping' and timeout to the interval", () => {
        expect(resolveHeartbeat({ interval: 5000 })).toEqual({
            interval: 5000,
            message: "ping",
            timeout: 5000
        });
    });

    it("honors custom message and timeout", () => {
        expect(
            resolveHeartbeat({
                interval: 10_000,
                message: { type: "hb" },
                timeout: 3000
            })
        ).toEqual({
            interval: 10_000,
            message: { type: "hb" },
            timeout: 3000
        });
    });

    it("uses an app-reserved close code", () => {
        expect(HEARTBEAT_TIMEOUT_CODE).toBe(4408);
    });
});
