import type { ConnectionEvent, ConnectionState } from "@/types";

/**
 * The connection lifecycle as an explicit finite state machine.
 *
 * A connection has a small, fixed set of legal states and transitions. Modelling
 * it as a table — rather than a free-form reducer — means an illegal transition
 * (e.g. a `CLOSED` event arriving while already `closed`) is *representable as the
 * absence of an entry* and can be rejected, instead of silently doing nothing.
 * That silent no-op is exactly what allowed the original close/error bug.
 *
 * `ERROR` is deliberately absent from the table: a transport error does not by
 * itself change the connection state (the browser/runtime fires `error` and then
 * `close`), so it is handled out-of-band by the client (record + emit) and the
 * following `CLOSED` event performs the actual transition.
 */
const TRANSITIONS: Record<
    ConnectionState,
    Partial<Record<ConnectionEvent, ConnectionState>>
> = {
    idle: { CONNECT: "connecting" },
    connecting: {
        OPEN: "open",
        CLOSE_REQUESTED: "closing",
        CLOSED: "closed",
        RETRY: "reconnecting"
    },
    open: {
        CLOSE_REQUESTED: "closing",
        CLOSED: "closed",
        RETRY: "reconnecting"
    },
    closing: { CLOSED: "closed" },
    // `reconnecting` = waiting out the backoff delay; no socket exists, so
    // CLOSE_REQUESTED goes straight to `closed` (there is nothing to wait for)
    // and OPEN/CLOSED cannot legally occur.
    reconnecting: {
        CONNECT: "connecting",
        CLOSE_REQUESTED: "closed"
    },
    closed: { CONNECT: "connecting" }
};

/**
 * Resolve the next state for an `(state, event)` pair.
 *
 * @returns the destination state, or `null` if the transition is illegal.
 */
export function nextState(
    state: ConnectionState,
    event: ConnectionEvent
): ConnectionState | null {
    return TRANSITIONS[state][event] ?? null;
}

/**
 * Whether `(state, event)` is a legal transition.
 */
export function canTransition(
    state: ConnectionState,
    event: ConnectionEvent
): boolean {
    return nextState(state, event) !== null;
}
