import type {
    Action,
    HandlerFn,
    Middleware,
    MiddlewareContext,
    Store
} from "@/types";
import { defineEventBus } from "./event-bus";

/**
 * Compose a list of actions into a single list of { event, handler } pairs.
 * This is useful for defining multiple actions at once, e.g.
 *   store.defineActions(composeActions(
 *       () => ({ event: "increment", handler: (state, payload) => ({ ...state, count: state.count + 1 }) }),
 *       () => ({ event: "decrement", handler: (state, payload) => ({ ...state, count: state.count - 1 }) })
 *   ));
 */
export function composeActions<S>(
    ...actions: Array<() => { event: string; handler: HandlerFn<S> }>
): Array<{ event: string; handler: HandlerFn<S> }> {
    return actions.map((action) => action());
}

/**
 * Creates a store with:
 *  - internal state
 *  - a map of eventName -> list of handler functions
 *  - an event bus for external subscriptions
 *  - a middleware pipeline for each dispatch
 *
 * Example usage:
 *
 * const store = defineStore({ count: 0 });
 *
 * // Define middleware
 *   store.use(
 *      (ctx, next) => {
 *          console.log("[middleware1] Before dispatch:", ctx.action.type);
 *          const result = next(); // could be a Promise or Action
 *          console.log("[middleware1] After dispatch:", ctx.action.type);
 *          return result;
 *      }
 *   );
 *
 *   store.defineAction("increment", (state, payload) => {
 *       return { ...state, count: state.count + 1 };
 *   });
 *
 *   store.dispatch("increment"); // triggers that handler
 *   console.log(store.getState()); // => { count: 1 }
 */
export function defineStore<S>(initialState: S): Store<S> {
    let state = initialState;
    const bus = defineEventBus();

    // Map from eventName -> list of handler functions
    const actionHandlers = new Map<string, Array<HandlerFn<S>>>();

    // Ordered list of middlewares to run on each dispatch
    const middlewares: Middleware<S>[] = [];

    // 1) New property to store references like { client, config, store, etc. }
    let storeWideContext: Partial<MiddlewareContext<S>> = {};

    // 2) Provide a simple method to set that context from the client:
    function setContext(ctx: Partial<MiddlewareContext<S>>) {
        storeWideContext = { ...storeWideContext, ...ctx };
    }

    /**
     * Registers a handler for a specific event name
     * e.g. store.defineAction("increment", (state, payload) => newState)
     */
    function defineAction(eventName: string, handler: HandlerFn<S>) {
        const existing = actionHandlers.get(eventName) ?? [];
        existing.push(handler);
        actionHandlers.set(eventName, existing);
    }

    function defineActions(
        actions: Array<{ event: string; handler: HandlerFn<S> }>
    ) {
        actions.forEach(({ event, handler }) => {
            defineAction(event, handler);
        });
    }

    // Add one or more middleware functions
    function use(...mws: Middleware<S>[]) {
        middlewares.push(...mws);
    }

    /**
     * The final step after all middlewares have run.
     * It updates the store state by calling each handler for the given eventName,
     * then emits the relevant events.
     */
    function runHandlersAndEmit(eventName: string, payload?: unknown): Action {
        const handlers = actionHandlers.get(eventName) ?? [];
        let stateChanged = false;

        for (const handler of handlers) {
            try {
                const newState = handler(state, payload);
                if (newState !== undefined && newState !== state) {
                    state = newState;
                    stateChanged = true;
                }
            } catch (error) {
                console.error(
                    `Handler for ${eventName} threw an error:`,
                    error
                );
                throw error;
            }
        }

        bus.emit(eventName, payload);

        if (stateChanged) {
            bus.emit("state-changed", { type: eventName, state });
        }

        return { type: eventName, payload };
    }

    /**
     * Recursively call each middleware in order. If we’ve called all of them,
     * runHandlersAndEmit is invoked to do the actual state update and event emission.
     */
    function applyMiddlewares(
        context: MiddlewareContext<S>
    ): Promise<Action> | Action {
        let index = -1;

        return executeMiddleware(0);

        async function executeMiddleware(i: number): Promise<Action> {
            if (i <= index) {
                throw new Error("next() called multiple times");
            }
            index = i;

            const middleware = middlewares[i];
            if (!middleware) {
                // No more middleware, invoke the final handler
                const { type, payload } = context.action;
                return runHandlersAndEmit(type, payload);
            }

            // Merge storeWideContext with the per-dispatch fields:
            const mergedContext: MiddlewareContext<S> = {
                ...storeWideContext,
                ...context
            };

            // Then call the current middleware with mergedContext
            return middleware(mergedContext, () => executeMiddleware(i + 1));
        }
    }

    /** The public dispatch method.
     *  Wraps action info into a context, then runs the pipeline.
     */
    function dispatch(
        eventName: string,
        payload?: unknown
    ): Promise<Action> | Action {
        const action: Action = { type: eventName, payload };
        // The minimal context for this dispatch:
        const context: MiddlewareContext<S> = {
            action,
            state
        } as MiddlewareContext<S>;
        return applyMiddlewares(context);
    }

    function getState(): S {
        return state;
    }

    // Expose the standard event bus API for external subscriptions:
    const store = {
        getState,
        dispatch,
        defineAction,
        defineActions,
        use,
        on: bus.on,
        off: bus.off,

        // 4) Expose setContext so the client can give us references
        setContext
    };

    return store;
}
