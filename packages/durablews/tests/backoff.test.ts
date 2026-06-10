import { describe, expect, it } from "vitest";
import {
    computeDelay,
    RECONNECT_DEFAULTS,
    resolveReconnect
} from "../src/backoff";

const noJitter = { ...RECONNECT_DEFAULTS, jitter: false };

describe("resolveReconnect", () => {
    it("returns null when reconnection is disabled", () => {
        expect(resolveReconnect(false)).toBeNull();
    });

    it("returns the defaults when no options are given", () => {
        expect(resolveReconnect(undefined)).toEqual(RECONNECT_DEFAULTS);
    });

    it("merges partial options over the defaults", () => {
        const resolved = resolveReconnect({ baseDelay: 100, maxRetries: 3 });
        expect(resolved).toEqual({
            ...RECONNECT_DEFAULTS,
            baseDelay: 100,
            maxRetries: 3
        });
    });
});

describe("computeDelay", () => {
    it("grows exponentially without jitter", () => {
        expect(computeDelay(0, noJitter)).toBe(500);
        expect(computeDelay(1, noJitter)).toBe(1000);
        expect(computeDelay(2, noJitter)).toBe(2000);
        expect(computeDelay(3, noJitter)).toBe(4000);
    });

    it("caps at maxDelay", () => {
        // 500 × 2^10 = 512_000 — far past the 30s cap.
        expect(computeDelay(10, noJitter)).toBe(30_000);
    });

    it("applies full jitter over [0, exponential)", () => {
        const opts = { ...RECONNECT_DEFAULTS, jitter: true };
        expect(computeDelay(1, opts, () => 0)).toBe(0);
        expect(computeDelay(1, opts, () => 0.5)).toBe(500);
        expect(computeDelay(1, opts, () => 0.999)).toBeCloseTo(999);
    });

    it("jitters within the capped window", () => {
        const opts = { ...RECONNECT_DEFAULTS, jitter: true };
        expect(computeDelay(20, opts, () => 1)).toBe(30_000);
    });

    it("respects custom base and factor", () => {
        const opts = { ...noJitter, baseDelay: 100, factor: 3 };
        expect(computeDelay(0, opts)).toBe(100);
        expect(computeDelay(1, opts)).toBe(300);
        expect(computeDelay(2, opts)).toBe(900);
    });
});
