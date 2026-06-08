import type { EventBus } from "@/types";

/**
 * Creates an event bus for managing event subscriptions and emissions.
 * Provides a simple pub/sub pattern with type-safe event handling.
 *
 * @returns EventBus instance with on, off, emit, and once methods
 *
 * @example
 * ```typescript
 * const eventBus = defineEventBus();
 *
 * // Subscribe to events
 * eventBus.on('user-login', (user) => {
 *   console.log('User logged in:', user);
 * });
 *
 * // Emit events
 * eventBus.emit('user-login', { id: 1, name: 'John' });
 *
 * // One-time subscription
 * eventBus.once('app-ready', () => {
 *   console.log('App is ready!');
 * });
 * ```
 */
export function defineEventBus(): EventBus {
    const listeners = new Map<string, Array<(payload: unknown) => void>>();

    /**
     * Subscribes to an event with a handler function.
     *
     * @template T - The type of the event payload
     * @param eventName - The name of the event to listen for
     * @param handler - Function to call when the event is emitted
     */
    function on<T = unknown>(
        eventName: string,
        handler: (payload: T) => void
    ): void {
        const handlers = listeners.get(eventName) ?? [];
        handlers.push(handler as (payload: unknown) => void);
        listeners.set(eventName, handlers);
    }

    /**
     * Unsubscribes a handler from an event.
     *
     * @template T - The type of the event payload
     * @param eventName - The name of the event to stop listening for
     * @param handler - The handler function to remove
     */
    function off<T = unknown>(
        eventName: string,
        handler: (payload: T) => void
    ) {
        const handlers = listeners.get(eventName);
        if (!handlers) return;
        listeners.set(
            eventName,
            handlers.filter((h) => h !== handler)
        );
    }

    /**
     * Subscribes to an event with a handler that will only be called once.
     * The handler is automatically removed after the first emission.
     *
     * @template T - The type of the event payload
     * @param eventName - The name of the event to listen for
     * @param handler - Function to call when the event is emitted (only once)
     */
    function once<T = unknown>(
        eventName: string,
        handler: (payload: T) => void
    ): void {
        const onceHandler = (payload: T) => {
            // Remove the handler after first invocation
            off(eventName, onceHandler as (payload: unknown) => void);
            // Call the original handler
            handler(payload);
        };

        // Add the wrapper handler
        on(eventName, onceHandler);
    }

    /**
     * Emits an event to all subscribed handlers.
     *
     * @template T - The type of the event payload
     * @param eventName - The name of the event to emit
     * @param payload - The data to pass to event handlers
     */
    function emit<T = unknown>(eventName: string, payload: T) {
        const handlers = listeners.get(eventName);
        handlers?.forEach((fn) => {
            fn(payload);
        });
    }

    return { on, off, emit, once };
}
