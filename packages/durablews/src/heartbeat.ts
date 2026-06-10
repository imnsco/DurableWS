import type { HeartbeatOptions } from "@/types";

/** `HeartbeatOptions` with every field filled in. */
export interface ResolvedHeartbeat {
    readonly interval: number;
    readonly message: unknown;
    readonly timeout: number;
}

/**
 * The close code used when the heartbeat declares the link dead (app-reserved
 * 4xxx range, mnemonic for HTTP 408 Request Timeout). Useful in a custom
 * `shouldReconnect` to distinguish heartbeat closes from server closes.
 */
export const HEARTBEAT_TIMEOUT_CODE = 4408;

/**
 * Resolve the user's `heartbeat` config. Heartbeat is **opt-in**: absence means
 * off (`null`) — a naive "no traffic → reconnect" would kill legitimately
 * quiet-but-healthy connections, and any ping depends on app-level semantics
 * the library can't assume (see the RFC's M3 decisions).
 */
export function resolveHeartbeat(
    option: HeartbeatOptions | undefined
): ResolvedHeartbeat | null {
    if (option === undefined) {
        return null;
    }
    return {
        interval: option.interval,
        message: option.message ?? "ping",
        timeout: option.timeout ?? option.interval
    };
}
