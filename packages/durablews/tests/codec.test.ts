import { describe, expect, it } from "vitest";
import { jsonCodec } from "../src/codec";

describe("jsonCodec", () => {
    describe("encode", () => {
        it("passes strings through verbatim", () => {
            expect(jsonCodec.encode("hello")).toBe("hello");
        });

        it("JSON-stringifies non-strings", () => {
            expect(jsonCodec.encode({ a: 1 })).toBe('{"a":1}');
            expect(jsonCodec.encode([1, 2])).toBe("[1,2]");
            expect(jsonCodec.encode(42)).toBe("42");
        });
    });

    describe("decode", () => {
        it("parses JSON text frames", () => {
            expect(jsonCodec.decode('{"a":1}')).toEqual({ a: 1 });
        });

        it("falls back to the raw string for non-JSON text", () => {
            expect(jsonCodec.decode("ping")).toBe("ping");
        });

        it("passes binary frames through untouched", () => {
            const buf = new ArrayBuffer(4);
            expect(jsonCodec.decode(buf)).toBe(buf);
        });
    });
});
