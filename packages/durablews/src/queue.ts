import type { QueueOptions } from "@/types";

/** `QueueOptions` with every field filled in. */
export type ResolvedQueue = Required<QueueOptions>;

/**
 * The default outbound-queue policy: bounded at 256 messages, drop-oldest.
 * Never silently unbounded (a memory leak), never silently lossy (every drop
 * emits a `drop` event). See the RFC's M3 decisions.
 */
export const QUEUE_DEFAULTS: ResolvedQueue = {
    maxSize: 256
};

/**
 * Resolve the user's `queue` config: `false` disables queueing entirely
 * (`null`), anything else is merged over the defaults.
 */
export function resolveQueue(
    option: false | QueueOptions | undefined
): ResolvedQueue | null {
    if (option === false) {
        return null;
    }
    return { ...QUEUE_DEFAULTS, ...option };
}
