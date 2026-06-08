import type { ClientState, Payload } from "@/types";

/**
 * Handles incoming WebSocket messages by adding them to the client state.
 * This is the default message handler that stores all received messages.
 *
 * @param state - Current client state
 * @param payload - The message payload received from the WebSocket
 * @returns Updated state with the new message added to the messages array
 *
 * @example
 * ```typescript
 * // This handler is automatically registered in the client
 * // When a message is received, it's added to state.messages
 * const newState = onMessage(currentState, { type: 'chat', text: 'Hello!' });
 * ```
 */
export function onMessage(state: ClientState, payload: Payload) {
    return { ...state, messages: [...state.messages, payload] };
}
