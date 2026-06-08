import connectionActions from "@/actions/connection-handlers";
import { onMessage } from "@/actions/message-handlers";
import { defineStore } from "@/helpers/store";
import { logger, pingpong } from "@/middleware/pingpong";
import type {
    ClientState,
    Middleware,
    Store,
    WebSocketClient,
    WebSocketClientConfig
} from "@/types";
import { SocketState } from "@/types";
import { safeJSONParse } from "@/utils";

/**
 * Creates a WebSocket client with state management, middleware support, and event handling.
 *
 * @param config - Configuration object containing WebSocket URL and other options
 * @returns A WebSocketClient instance with connect, send, close, on, and use methods
 *
 * @example
 * ```typescript
 * const wsClient = client({ url: 'ws://localhost:8080' });
 *
 * // Connect to WebSocket
 * await wsClient.connect();
 *
 * // Listen for events
 * const unsubscribe = wsClient.on('message', (data) => {
 *   console.log('Received:', data);
 * });
 *
 * // Send data
 * wsClient.send({ type: 'hello', payload: 'world' });
 *
 * // Clean up
 * unsubscribe();
 * wsClient.close();
 * ```
 */
export function client(config: WebSocketClientConfig): WebSocketClient {
    let ws: WebSocket | null = null;

    const initialState: ClientState = {
        connected: false,
        connectionState: SocketState.IDLE,
        messages: []
    };

    const store = defineStore<ClientState>(initialState);
    store.defineActions(connectionActions);
    store.defineAction("message", onMessage);

    /**
     * Factory function that creates the WebSocket client API with all methods.
     *
     * @param store - The state store instance for managing client state
     * @returns WebSocketClient API object with all client methods
     */
    const api = (store: Store<ClientState>): WebSocketClient => {
        return {
            /**
             * Establishes a WebSocket connection to the configured URL.
             * Handles connection state management and sets up event listeners.
             *
             * @returns Promise that resolves when connection attempt is initiated
             */
            async connect() {
                console.log("connect() called");
                if (ws && ws.readyState !== WebSocket.CLOSED) {
                    return;
                }
                store.dispatch("connecting");
                ws = new WebSocket(config.url);

                ws.onopen = () => {
                    store.dispatch("connected");
                };
                ws.onclose = (closeEvent) => {
                    store.dispatch("close", closeEvent);
                };
                ws.onerror = (err) => {
                    console.log("onerror called");
                    store.dispatch("error", err);
                };
                ws.onmessage = (event) => {
                    const message = safeJSONParse<unknown>(event.data);
                    store.dispatch("message", message);
                };
            },
            /**
             * Closes the WebSocket connection and cleans up resources.
             */
            close() {
                ws?.close();
                ws = null;
            },
            /**
             * Sends data through the WebSocket connection.
             * Automatically stringifies non-string data as JSON.
             *
             * @param data - The data to send (string or any serializable object)
             */
            send(data: unknown) {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    if (typeof data === "string") {
                        ws.send(data);
                    } else {
                        ws.send(JSON.stringify(data));
                    }
                } else {
                    console.warn(
                        "WebSocket not open. Could not send message:",
                        data
                    );
                }
            },
            /**
             * Subscribes to events from the WebSocket client.
             *
             * @param eventName - The name of the event to listen for
             * @param handler - Callback function to handle the event
             * @returns Unsubscribe function to remove the event listener
             *
             * @example
             * ```typescript
             * const unsubscribe = client.on('message', (data) => {
             *   console.log('Received:', data);
             * });
             *
             * // Later, remove the listener
             * unsubscribe();
             * ```
             */
            on<T = unknown>(eventName: string, handler: (payload: T) => void) {
                store.on<T>(eventName, handler);
                return () => store.off<T>(eventName, handler);
            },
            /**
             * Adds middleware to the client for intercepting and processing actions.
             *
             * @param middleware - Middleware function to add to the processing chain
             *
             * @example
             * ```typescript
             * client.use((store, next, action, payload, context) => {
             *   console.log('Action:', action, 'Payload:', payload);
             *   return next(action, payload);
             * });
             * ```
             */
            use(middleware: Middleware<ClientState>) {
                store.use(middleware);
            }
        };
    };

    const clientApi = api(store);

    // Set the additional context that gets passed to each middleware
    store.setContext({
        client: clientApi,
        config
    });

    // Add internal middleware
    store.use(pingpong);
    store.use(logger);

    return clientApi;
}
