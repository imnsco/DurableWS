/**
 * The functional shape shared by inbound and outbound middleware: receive a
 * context and a `next`, optionally async. The context type is the only thing
 * that differs per direction.
 */
type PipelineMiddleware<TContext> = (
    ctx: TContext,
    next: () => void | Promise<void>
) => void | Promise<void>;

/**
 * Runs a message through a middleware chain (onion model).
 *
 * Each middleware receives the shared context and a `next` it may call to pass
 * control onward. When the chain runs to completion, `terminal` is invoked —
 * for inbound messages that is where the client emits `message`; for outbound,
 * where it encodes and writes to the socket. A middleware that returns without
 * calling `next()` short-circuits the chain (and `terminal`).
 *
 * Mirrors the guard from the old store pipeline: calling `next()` more than once
 * in a single middleware is a bug and throws.
 *
 * @returns `void`, or a `Promise` if any middleware in the chain is async.
 */
export function runPipeline<TContext>(
    middlewares: readonly PipelineMiddleware<TContext>[],
    ctx: TContext,
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
