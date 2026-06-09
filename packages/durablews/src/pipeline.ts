import type { MessageContext, Middleware } from "@/types";

/**
 * Runs an inbound message through the middleware chain (onion model).
 *
 * Each middleware receives the shared context and a `next` it may call to pass
 * control onward. When the chain runs to completion, `terminal` is invoked —
 * this is where the client emits the `message` event. A middleware that returns
 * without calling `next()` short-circuits the chain (and `terminal`).
 *
 * Mirrors the guard from the old store pipeline: calling `next()` more than once
 * in a single middleware is a bug and throws.
 *
 * @returns `void`, or a `Promise` if any middleware in the chain is async.
 */
export function runPipeline(
    middlewares: readonly Middleware[],
    ctx: MessageContext,
    terminal: () => void
): void | Promise<void> {
    let invoked = -1;

    function dispatch(i: number): void | Promise<void> {
        if (i <= invoked) {
            throw new Error("next() called multiple times");
        }
        invoked = i;

        const middleware = middlewares[i];
        if (!middleware) {
            return terminal();
        }
        return middleware(ctx, () => dispatch(i + 1));
    }

    return dispatch(0);
}
