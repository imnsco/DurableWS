import { client } from "@/client";
import type { WebSocketClient, WebSocketClientConfig } from "@/types";

/**
 * What a framework binding accepts: either a config (the binding creates and
 * **owns** the client — connecting it and closing it with the component) or an
 * existing client (the binding only **observes** it — sharing one connection
 * across many components without any binding taking over its lifecycle).
 */
export type UseWebSocketSource<TIn = unknown, TOut = unknown> =
    | WebSocketClientConfig
    | WebSocketClient<TIn, TOut>;

export interface ResolvedSource<TIn = unknown, TOut = unknown> {
    readonly client: WebSocketClient<TIn, TOut>;
    /** Whether the binding created the client and therefore owns its lifecycle. */
    readonly owned: boolean;
}

/**
 * Resolves a binding source into a client plus ownership. A config produces a
 * fresh, owned client; a passed-in client is borrowed as-is.
 */
export function resolveSource<TIn = unknown, TOut = unknown>(
    source: UseWebSocketSource<TIn, TOut>
): ResolvedSource<TIn, TOut> {
    if (isClient(source)) {
        return { client: source, owned: false };
    }
    return {
        client: client(source) as WebSocketClient<TIn, TOut>,
        owned: true
    };
}

function isClient<TIn, TOut>(
    source: UseWebSocketSource<TIn, TOut>
): source is WebSocketClient<TIn, TOut> {
    return typeof (source as WebSocketClient).subscribe === "function";
}

/**
 * Whether a standard `WebSocket` global exists. Bindings skip auto-connect in
 * its absence (e.g. SSR), so creating a component server-side never throws —
 * the client connects when setup runs again in the browser.
 */
export function canConnect(): boolean {
    return typeof WebSocket !== "undefined";
}
