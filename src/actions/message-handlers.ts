import { ClientState, Payload } from "@/types";

/**\n * Handles incoming WebSocket messages by adding them to the client state.\n * This is the default message handler that stores all received messages.\n * \n * @param state - Current client state\n * @param payload - The message payload received from the WebSocket\n * @returns Updated state with the new message added to the messages array\n * \n * @example\n * ```typescript\n * // This handler is automatically registered in the client\n * // When a message is received, it's added to state.messages\n * const newState = onMessage(currentState, { type: 'chat', text: 'Hello!' });\n * ```\n */\nexport function onMessage(state: ClientState, payload: Payload) {
    return { ...state, messages: [...state.messages, payload] };
}
