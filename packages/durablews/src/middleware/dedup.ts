import type { DirectionalMiddleware } from "@/types";

/**
 * Options for {@link dedup}.
 */
export interface DedupOptions {
    /**
     * Extracts the identity of a message. Two inbound messages with the same
     * key are treated as duplicates. Required: messages have no built-in id.
     */
    key: (data: unknown) => string;
    /**
     * How many recent keys to remember. Bounded, drop-oldest: once the limit
     * is reached the oldest key is forgotten (a duplicate that arrives later
     * than `window` distinct messages ago is no longer detected). Default
     * `1000`.
     */
    window?: number;
}

/**
 * Inbound middleware that drops duplicate messages, so a server that
 * redelivers (at-least-once) never reaches your handler twice.
 *
 * Memory is bounded by `window` (drop-oldest), in the same spirit as the core
 * send queue: never silently unbounded.
 *
 * ```typescript
 * import { defineClient } from "durablews";
 * import { dedup } from "durablews/middleware";
 *
 * const ws = defineClient({ url }).use(
 *     dedup({ key: (m) => (m as { id: string }).id })
 * );
 * ```
 *
 * A duplicate is short-circuited: it is not emitted as a `message` event (and
 * no `drop` event fires, since that is reserved for outbound delivery loss).
 */
export function dedup(options: DedupOptions): DirectionalMiddleware {
    const max = options.window ?? 1000;
    const seen = new Set<string>();

    return {
        inbound: (ctx, next) => {
            const k = options.key(ctx.data);
            if (seen.has(k)) {
                return;
            }
            seen.add(k);
            if (seen.size > max) {
                const oldest = seen.values().next().value;
                if (oldest !== undefined) {
                    seen.delete(oldest);
                }
            }
            return next();
        }
    };
}
