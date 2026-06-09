import type { Middleware } from "@/types";

/**
 * Replies to a textual `"ping"` with `"pong"` and stops the message there
 * (it is not emitted as a `message` event). A common keepalive convention.
 *
 * Opt in explicitly — it is not registered by default:
 *
 * ```typescript
 * import { defineClient, pingpong } from "durablews";
 *
 * const ws = defineClient({ url }).use(pingpong);
 * ```
 */
export const pingpong: Middleware = (ctx, next) => {
    if (ctx.data === "ping") {
        ctx.client.send("pong");
        return;
    }
    return next();
};
