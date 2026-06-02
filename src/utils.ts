/**
 * Safely parses JSON data, returning the original data if parsing fails.
 * This is useful for handling WebSocket messages that might be either JSON or plain text.
 *
 * @template T - The expected type of the parsed data
 * @param data - The string data to parse as JSON
 * @returns The parsed JSON object of type T, or the original data if parsing fails
 *
 * @example
 * ```typescript
 * // Parsing valid JSON
 * const obj = safeJSONParse<{message: string}>('{"message": "hello"}');
 * // Returns: {message: "hello"}
 *
 * // Handling plain text
 * const text = safeJSONParse<string>('plain text message');
 * // Returns: 'plain text message'
 * ```
 */
export function safeJSONParse<T>(data: string): T {
    try {
        return JSON.parse(data) as T;
    } catch (error) {
        return data as T;
    }
}

/**
 * Normalizes a URL by extracting and cleaning the host
 * @throws {Error} If URL is invalid or empty
 */
export function normalizeURL(url: string): string {
    if (!url?.trim()) {
        throw new Error("URL cannot be empty");
    }

    try {
        const urlObj = new URL(url);
        let host = urlObj.host.toLowerCase(); // Normalize case

        // Remove trailing slash if present
        host = host.replace(/\/+$/, "");

        // Validate pathname
        if (urlObj.pathname && urlObj.pathname !== "/") {
            throw new Error("URL should not contain a path");
        }

        return host;
    } catch (error: unknown) {
        throw new Error(
            `Invalid URL: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}
