import type {
    ClientState,
    Middleware,
    MiddlewareContext,
    NextFn
} from "@/types";

/**
 * Middleware that automatically responds to "ping" messages with "pong".
 * This is commonly used for WebSocket keepalive mechanisms.
 *
 * @param ctx - The middleware context containing action and client information
 * @param next - Function to call the next middleware in the chain
 * @returns The result of calling the next middleware
 *
 * @example
 * ```typescript
 * // The middleware automatically handles ping/pong
 * client.use(pingpong);
 *
 * // When server sends "ping", client automatically responds with "pong"
 * ```
 */
export const pingpong: Middleware = (ctx, next) => {
    if (ctx.action.type === "message" && ctx.action.payload === "ping") {
        ctx.client.send("pong");
    }
    return next();
};

/**
 * Middleware that logs all actions passing through the middleware chain.
 * Useful for debugging and monitoring WebSocket client activity.
 *
 * @param ctx - The middleware context containing action information
 * @param next - Function to call the next middleware in the chain
 * @returns Promise that resolves with the result of the next middleware
 *
 * @example
 * ```typescript
 * client.use(logger);
 * // Will log: "[INFO] event connected called" when connection is established
 * ```
 */
export async function logger(
    ctx: MiddlewareContext<ClientState>,
    next: NextFn
) {
    console.log(`[INFO] event ${ctx.action.type} called`);
    return await next();
}
