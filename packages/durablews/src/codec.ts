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
 * The default codec: JSON over text frames.
 *
 * - `encode` — strings are sent verbatim; everything else is `JSON.stringify`d.
 * - `decode` — text frames are JSON-parsed (falling back to the raw string);
 *   binary frames (`ArrayBuffer`/`Blob`) are passed through untouched.
 */
export const jsonCodec: Codec = {
    encode(data: unknown) {
        return typeof data === "string" ? data : JSON.stringify(data);
    },
    decode(data: unknown) {
        return typeof data === "string" ? safeJSONParse(data) : data;
    }
};
