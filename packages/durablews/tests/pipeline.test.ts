import { describe, expect, it, vi } from "vitest";
import { runPipeline } from "../src/pipeline";
import type { MessageContext, Middleware } from "../src/types";

function ctx(data: unknown): MessageContext {
    return { data, client: {} as never };
}

describe("runPipeline", () => {
    it("runs middleware in registration order, then the terminal", () => {
        const calls: string[] = [];
        const mws: Middleware[] = [
            (_c, next) => {
                calls.push("a");
                return next();
            },
            (_c, next) => {
                calls.push("b");
                return next();
            }
        ];

        runPipeline(mws, ctx(null), () => calls.push("terminal"));

        expect(calls).toEqual(["a", "b", "terminal"]);
    });

    it("runs the terminal directly when there is no middleware", () => {
        const terminal = vi.fn();
        runPipeline([], ctx(null), terminal);
        expect(terminal).toHaveBeenCalledTimes(1);
    });

    it("short-circuits when a middleware does not call next()", () => {
        const terminal = vi.fn();
        const second = vi.fn((_c, next) => next());
        const mws: Middleware[] = [() => {}, second];

        runPipeline(mws, ctx(null), terminal);

        expect(second).not.toHaveBeenCalled();
        expect(terminal).not.toHaveBeenCalled();
    });

    it("propagates ctx.data transforms to later stages and the terminal", () => {
        const mws: Middleware[] = [
            (c, next) => {
                c.data = (c.data as number) + 1;
                return next();
            }
        ];
        const c = ctx(1);
        let seen: unknown;

        runPipeline(mws, c, () => {
            seen = c.data;
        });

        expect(seen).toBe(2);
    });

    it("throws if next() is called more than once", () => {
        const mws: Middleware[] = [
            (_c, next) => {
                next();
                return next();
            }
        ];
        expect(() => runPipeline(mws, ctx(null), () => {})).toThrow(
            /multiple times/
        );
    });

    it("returns a promise and awaits async middleware", async () => {
        const calls: string[] = [];
        const mws: Middleware[] = [
            async (_c, next) => {
                await Promise.resolve();
                calls.push("a");
                await next();
            }
        ];

        const result = runPipeline(mws, ctx(null), () =>
            calls.push("terminal")
        );

        expect(result).toBeInstanceOf(Promise);
        await result;
        expect(calls).toEqual(["a", "terminal"]);
    });
});
