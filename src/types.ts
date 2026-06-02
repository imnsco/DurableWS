/**
 * Configuration options for the WebSocket client.
 */
export interface WebSocketClientConfig {
    /** The URL to connect to. */
    readonly url: string;
}

/**
 * Represents the payload of a message, which can be a string or any other type.
 */
export type Payload = string | unknown;

/**
 * Represents the state of the WebSocket client.
 */
export interface ClientState {
    /** List of messages received. */
    messages: Payload[];
    /** Indicates if the client is currently connected. */
    connected: boolean;
    /** The current state of the socket connection. */
    connectionState: SocketState;
}

/**
 * Interface for a WebSocket client.
 */
export interface WebSocketClient {
    /**
     * Connects to the WebSocket server.
     * @returns A promise that resolves when the connection is established.
     */
    connect: () => Promise<void>;

    /**
     * Closes the WebSocket connection.
     */
    close: () => void;

    /**
     * Sends data to the WebSocket server.
     * @param data - The data to send.
     */
    send: (data: unknown) => void;

    /**
     * Subscribes to an event.
     * @param eventName - The name of the event to subscribe to.
     * @param handler - The function to handle the event.
     * @returns A function to unsubscribe from the event.
     */
    on: (eventName: string, handler: (payload: unknown) => void) => () => void;

    /**
     * Applies middleware to the client.
     * @param middleware - The middleware to apply.
     */
    use: (middleware: Middleware<ClientState>) => void;
}

/**
 * Possible events emitted by the WebSocket client.
 */
export type SocketEvent =
    | "connecting"
    | "connected"
    | "close"
    | "retry"
    | "disconnect";

/**
 * Event bus interface for managing event subscriptions and emissions.
 */
export interface EventBus {
    /**
     * Subscribes to an event.
     * @param eventName - The name of the event.
     * @param handler - The function to handle the event.
     */
    on<T = unknown>(eventName: string, handler: (payload: T) => void): void;

    /**
     * Unsubscribes from an event.
     * @param eventName - The name of the event.
     * @param handler - The function to remove from the event.
     */
    off<T = unknown>(eventName: string, handler: (payload: T) => void): void;

    /**
     * Emits an event.
     * @param eventName - The name of the event.
     * @param payload - The payload to send with the event.
     */
    emit<T = unknown>(eventName: string, payload?: T): void;

    /**
     * Subscribes to an event that will be automatically unsubscribed after first trigger.
     * @param eventName - The name of the event.
     * @param handler - The function to handle the event.
     */
    once<T = unknown>(eventName: string, handler: (payload: T) => void): void;
}

/**
 * Enum representing the possible states of a WebSocket connection.
 */
export enum SocketState {
    IDLE = "IDLE", // not yet connected
    CONNECTING = "CONNECTING",
    CONNECTED = "CONNECTED",
    RECONNECTING = "RECONNECTING",
    CLOSED = "CLOSED"
}

/**
 * Represents an action to be dispatched in the store.
 */
export interface Action<T = Payload> {
    /** The type of the action. */
    type: string;
    /** The payload of the action. */
    payload?: T;
}

/**
 * A function that updates the state in response to an event.
 */
export interface HandlerFn<S> {
    (state: S, payload: unknown): S | void;
}

/**
 * Function signature for the next middleware or final action.
 */
export type NextFn = () => Promise<Action> | Action;

/**
 * Middleware function signature.
 * @param context - The context for the middleware, including the store, current action, etc.
 * @param next - The callback to proceed to the next middleware or final action.
 */
export type Middleware<S = unknown> = (
    context: MiddlewareContext<S>,
    next: NextFn
) => Promise<Action> | Action;

/**
 * Context information passed to each middleware.
 */
export interface MiddlewareContext<S = unknown> {
    /** The current action being processed. */
    action: Action;
    /** The current state of the store. */
    state: S;
    /** Reference to the WebSocket client. */
    client: WebSocketClient;
    /** Configuration for the WebSocket client. */
    config: WebSocketClientConfig;
}

/**
 * Interface for a store that manages state and actions.
 */
export interface Store<S> {
    /**
     * Sets additional context for the store.
     * @param ctx - Partial context to set.
     */
    setContext(ctx: Partial<MiddlewareContext<S>>): void;

    /**
     * Gets the current state of the store.
     * @returns The current state.
     */
    getState(): S;

    /**
     * Dispatches an event to the store.
     * @param eventName - The name of the event.
     * @param payload - The payload for the event.
     * @returns The resulting action.
     */
    dispatch(eventName: string, payload?: unknown): Promise<Action> | Action;

    /**
     * Subscribes to an event.
     * @param eventName - The name of the event.
     * @param callback - The function to handle the event.
     */
    on<T = unknown>(eventName: string, callback: (payload: T) => void): void;

    /**
     * Unsubscribes from an event.
     * @param eventName - The name of the event.
     * @param callback - The function to remove from the event.
     */
    off<T = unknown>(eventName: string, callback: (payload: T) => void): void;

    /**
     * Defines a handler for a specific action.
     * @param eventName - The name of the event.
     * @param handler - The function to handle the event.
     */
    defineAction(eventName: string, handler: HandlerFn<S>): void;

    /**
     * Defines multiple actions at once.
     * @param actions - Array of actions to define.
     */
    defineActions(
        actions: Array<{ event: string; handler: HandlerFn<S> }>
    ): void;

    /**
     * Applies middleware to the store.
     * @param middlewares - The middleware functions to apply.
     */
    use(...middlewares: Middleware<S>[]): void;
}

/**
 * A helper for registering multiple event-action mappings at once.
 */
export interface ActionRegistration<S> {
    /** The event name. */
    event: string;
    /** The handler function for the event. */
    handler: HandlerFn<S>;
}
