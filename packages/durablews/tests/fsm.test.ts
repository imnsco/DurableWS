import { describe, expect, it } from "vitest";
import { canTransition, nextState } from "../src/fsm";
import type { ConnectionEvent, ConnectionState } from "../src/types";

describe("connection FSM", () => {
    const legal: Array<[ConnectionState, ConnectionEvent, ConnectionState]> = [
        ["idle", "CONNECT", "connecting"],
        ["connecting", "OPEN", "open"],
        ["connecting", "CLOSE_REQUESTED", "closing"],
        ["connecting", "CLOSED", "closed"],
        ["open", "CLOSE_REQUESTED", "closing"],
        ["open", "CLOSED", "closed"],
        ["closing", "CLOSED", "closed"],
        ["closed", "CONNECT", "connecting"]
    ];

    it.each(legal)("%s + %s -> %s", (from, event, to) => {
        expect(nextState(from, event)).toBe(to);
        expect(canTransition(from, event)).toBe(true);
    });

    // The bug this FSM exists to prevent: a CLOSED arriving in a state that has
    // no transition for it must be rejected, not silently swallowed.
    const illegal: Array<[ConnectionState, ConnectionEvent]> = [
        ["idle", "OPEN"],
        ["idle", "CLOSED"],
        ["idle", "CLOSE_REQUESTED"],
        ["connecting", "CONNECT"],
        ["open", "CONNECT"],
        ["open", "OPEN"],
        ["closing", "CONNECT"],
        ["closing", "OPEN"],
        ["closed", "OPEN"],
        ["closed", "CLOSED"],
        ["closed", "CLOSE_REQUESTED"]
    ];

    it.each(illegal)("%s + %s is illegal", (from, event) => {
        expect(nextState(from, event)).toBeNull();
        expect(canTransition(from, event)).toBe(false);
    });
});
