import type {
    ConnectionState,
    DirectionalMiddleware,
    Middleware,
    OutboundMiddleware
} from "@/types";

/**
 * One logged message, in either direction.
 */
export interface LogEntry {
    /** Which way the message was flowing. */
    direction: "inbound" | "outbound";
    /** The message, after {@link LoggerOptions.redact} if one was given. */
    data: unknown;
    /** `Date.now()` when the message was logged. */
    timestamp: number;
    /** The connection state at log time. */
    state: ConnectionState;
}

/**
 * Options for {@link logger}.
 */
export interface LoggerOptions {
    /**
     * Where entries go. Defaults to `console.debug`. Swap in your structured
     * logger to pipe traffic into an observability stack.
     */
    log?: (entry: LogEntry) => void;
    /**
     * Scrub secrets/PII before logging. Receives the message and returns what
     * to log; the original is never altered, so the wire and your handlers are
     * unaffected. Defaults to logging the message as-is.
     */
    redact?: (data: unknown) => unknown;
    /** Which direction(s) to log. Defaults to `"both"`. */
    direction?: "inbound" | "outbound" | "both";
}

/**
 * Logs every message passing through the client, in both directions, without
 * altering it.
 *
 * The production-grade part is {@link LoggerOptions.redact}: structured output
 * with secrets and PII scrubbed, so you never leak an auth token into your
 * logs.
 *
 * ```typescript
 * import { defineClient } from "durablews";
 * import { logger } from "durablews/middleware";
 *
 * const ws = defineClient({ url }).use(
 *     logger({
 *         redact: (data) => ({ ...data, token: "[redacted]" })
 *     })
 * );
 * ```
 */
export function logger(options: LoggerOptions = {}): DirectionalMiddleware {
    const sink =
        options.log ?? ((entry) => console.debug("[durablews]", entry));
    const redact = options.redact ?? ((data: unknown) => data);
    const direction = options.direction ?? "both";

    const record = (
        dir: LogEntry["direction"],
        data: unknown,
        state: ConnectionState
    ): void => {
        sink({
            direction: dir,
            data: redact(data),
            timestamp: Date.now(),
            state
        });
    };

    const inbound: Middleware = (ctx, next) => {
        record("inbound", ctx.data, ctx.client.state);
        return next();
    };
    const outbound: OutboundMiddleware = (ctx, next) => {
        record("outbound", ctx.data, ctx.client.state);
        return next();
    };

    if (direction === "inbound") {
        return { inbound };
    }
    if (direction === "outbound") {
        return { outbound };
    }
    return { inbound, outbound };
}
