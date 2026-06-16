import type { DirectionalMiddleware } from "@/types";

/**
 * Options for {@link auth}.
 */
export interface AuthOptions<TOut = unknown> {
    /**
     * Produces the current credential. Called at **transmission time** for
     * every outbound message, so a message queued across a reconnect is sent
     * with a token that is fresh when it actually goes out, not when `send()`
     * was first called. May be async (e.g. await a refresh endpoint).
     */
    token: () => string | Promise<string>;
    /**
     * Injects the token into the outgoing message and returns the value to
     * send. Required: messages are app-shaped, so there is no universal
     * placement. The queue and `drop` events keep the original untouched.
     */
    inject: (data: TOut, token: string) => TOut;
}

/**
 * Outbound middleware that injects a fresh credential into every outgoing
 * message, resolved at transmission time.
 *
 * The hard parts (transmission-time execution, ordered async) are in the core
 * pipeline; this is the small, correct glue over them. Because the token is
 * resolved when the message actually goes out, a message that was queued
 * across a 30s reconnect still carries a current token.
 *
 * ```typescript
 * import { defineClient } from "durablews";
 * import { auth } from "durablews/middleware";
 *
 * const ws = defineClient({ url }).use(
 *     auth({
 *         token: () => getAccessToken(),            // may be async
 *         inject: (data, token) => ({ ...data, token })
 *     })
 * );
 * ```
 *
 * If `token()` throws or rejects, that one message is not sent and the failure
 * surfaces as an `error` event; later messages are unaffected.
 */
export function auth<TOut = unknown>(
    options: AuthOptions<TOut>
): DirectionalMiddleware<unknown, TOut> {
    return {
        outbound: async (ctx, next) => {
            const token = await options.token();
            ctx.data = options.inject(ctx.data, token);
            await next();
        }
    };
}
