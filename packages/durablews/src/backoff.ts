import type { ReconnectOptions } from "@/types";

/** `ReconnectOptions` with every field filled in. */
export type ResolvedReconnect = Required<ReconnectOptions>;

/**
 * The durable-by-default reconnection policy: full-jitter exponential backoff,
 * never give up. See the RFC's M3 decisions for the rationale behind each value.
 */
export const RECONNECT_DEFAULTS: ResolvedReconnect = {
    baseDelay: 500,
    factor: 2,
    maxDelay: 30_000,
    jitter: true,
    maxRetries: Number.POSITIVE_INFINITY,
    shouldReconnect: () => true
};

/**
 * Resolve the user's `reconnect` config: `false` disables reconnection
 * entirely (`null`), anything else is merged over the defaults.
 */
export function resolveReconnect(
    option: false | ReconnectOptions | undefined
): ResolvedReconnect | null {
    if (option === false) {
        return null;
    }
    return { ...RECONNECT_DEFAULTS, ...option };
}

/**
 * Compute the backoff delay for a retry.
 *
 * The exponential delay is `baseDelay × factorᵃᵗᵗᵉᵐᵖᵗ`, capped at `maxDelay`.
 * With jitter (the default), the actual delay is drawn uniformly from
 * `[0, exponential]` — "full jitter", which spreads a fleet of simultaneously
 * dropped clients across the whole window instead of letting them retry in
 * synchronized waves.
 *
 * @param attempt - 0-based: the first retry is attempt `0`.
 * @param random - injectable for deterministic tests; defaults to `Math.random`.
 */
export function computeDelay(
    attempt: number,
    options: ResolvedReconnect,
    random: () => number = Math.random
): number {
    const exponential = Math.min(
        options.maxDelay,
        options.baseDelay * options.factor ** attempt
    );
    return options.jitter ? random() * exponential : exponential;
}
