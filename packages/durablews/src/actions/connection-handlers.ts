import { composeActions } from "@/helpers/store";
import { type ClientState, SocketState } from "@/types";

/**
 * Creates an action handler for the "connecting" event.
 * Updates the client state to indicate a connection attempt is in progress.
 *
 * @returns Action object with event name and handler function
 */
export const onConnecting = () => ({
    event: "connecting",
    handler: (state: ClientState) => {
        return { ...state, connectionState: SocketState.CONNECTING };
    }
});

/**
 * Creates an action handler for the "connected" event.
 * Updates the client state to indicate a successful WebSocket connection.
 *
 * @returns Action object with event name and handler function
 */
export function onConnected() {
    return {
        event: "connected",
        handler: (state: ClientState) => {
            return {
                ...state,
                connected: true,
                connectionState: SocketState.CONNECTED
            };
        }
    };
}

/**
 * Creates an action handler for the "closed" event.
 * Updates the client state to indicate the WebSocket connection has been closed.
 *
 * @returns Action object with event name and handler function
 */
export function onClosed() {
    return {
        event: "closed",
        handler: (state: ClientState) => {
            return {
                ...state,
                connected: false,
                connectionState: SocketState.CLOSED
            };
        }
    };
}

/**
 * Composed collection of all connection-related action handlers.
 * Includes connecting, connected, and closed state handlers.
 *
 * @example
 * ```typescript
 * // These handlers are automatically registered in the client
 * store.defineActions(connectionActions);
 * ```
 */
export default composeActions(onConnecting, onConnected, onClosed);
