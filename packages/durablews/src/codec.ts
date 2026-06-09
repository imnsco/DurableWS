import type { Codec } from "@/types";

/**
 * Parse a string as JSON, falling back to the raw string when it isn't valid
 * JSON. Lets text protocols that mix JSON and plain strings work unchanged.
 */
function safeJSONParse(data: string): unknown {
    try {
        return JSON.parse(data);
    } catch {
        return data;
    }
}

/**
 * Whether a value is already a WebSocket-sendable binary frame and should be
 * passed through rather than JSON-encoded (`ArrayBuffer`, any typed array or
 * `DataView`, or a `Blob`).
 */
function isBinary(
    data: unknown
): data is ArrayBufferLike | ArrayBufferView | Blob {
    return (
        data instanceof ArrayBuffer ||
        ArrayBuffer.isView(data) ||
        (typeof Blob !== "undefined" && data instanceof Blob)
    );
}

/**
 * The default codec: JSON over text frames, binary passed through.
 *
 * - `encode` — strings and binary frames (`ArrayBuffer`/typed arrays/`Blob`)
 *   are sent verbatim; everything else is `JSON.stringify`d.
 * - `decode` — text frames are JSON-parsed (falling back to the raw string);
 *   binary frames are passed through untouched.
 */
export const jsonCodec: Codec = {
    encode(data: unknown) {
        if (typeof data === "string" || isBinary(data)) {
            return data;
        }
        return JSON.stringify(data);
    },
    decode(data: unknown) {
        return typeof data === "string" ? safeJSONParse(data) : data;
    }
};
