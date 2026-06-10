import { describe, expectTypeOf, it } from "vitest";
import { defineClient } from "../src/index";
import type { StandardSchemaV1 } from "../src/schema";
import type { DropEvent } from "../src/types";

const URL = "ws://localhost:9999";

// A minimal Standard Schema whose output type is a chat message.
interface Chat {
    readonly type: "chat";
    readonly body: string;
}
const chatSchema: StandardSchemaV1<unknown, Chat> = {
    "~standard": {
        version: 1,
        vendor: "durablews-tests",
        validate: (value) =>
            typeof value === "object" && value !== null
                ? { value: value as Chat }
                : { issues: [{ message: "not a chat message" }] }
    }
};

describe("typed messages (compile-time)", () => {
    it("infers the message type from a schema", () => {
        const ws = defineClient({ url: URL, schema: chatSchema });
        ws.on("message", (msg) => {
            expectTypeOf(msg).toEqualTypeOf<Chat>();
        });
    });

    it("accepts explicit in/out generics", () => {
        const ws = defineClient<Chat, string>({ url: URL });
        ws.on("message", (msg) => {
            expectTypeOf(msg).toEqualTypeOf<Chat>();
        });
        expectTypeOf(ws.send).parameter(0).toEqualTypeOf<string>();
        // Compile-time only — never invoked (send() throws while idle).
        void (() => {
            // @ts-expect-error send only accepts the outbound type
            ws.send({ type: "chat", body: "nope" });
        });
    });

    it("defaults to unknown without schema or generics", () => {
        const ws = defineClient({ url: URL });
        ws.on("message", (msg) => {
            expectTypeOf(msg).toEqualTypeOf<unknown>();
        });
        expectTypeOf(ws.send).parameter(0).toEqualTypeOf<unknown>();
    });

    it("types the drop event with the outbound type", () => {
        const ws = defineClient<Chat, string>({ url: URL });
        ws.on("drop", (event) => {
            expectTypeOf(event).toEqualTypeOf<DropEvent<string>>();
            expectTypeOf(event.data).toEqualTypeOf<string>();
        });
    });

    it("types middleware context with the inbound type", () => {
        const ws = defineClient<Chat>({ url: URL });
        ws.use((ctx, next) => {
            expectTypeOf(ctx.data).toEqualTypeOf<Chat>();
            return next();
        });
    });

    it("types outbound middleware context with the outbound type", () => {
        const ws = defineClient<Chat, string>({ url: URL });
        ws.use({
            inbound: (ctx, next) => {
                expectTypeOf(ctx.data).toEqualTypeOf<Chat>();
                return next();
            },
            outbound: (ctx, next) => {
                expectTypeOf(ctx.data).toEqualTypeOf<string>();
                return next();
            }
        });
    });

    it("lifecycle events keep their fixed payload types", () => {
        const ws = defineClient({ url: URL, schema: chatSchema });
        ws.on("close", (event) => {
            expectTypeOf(event).toEqualTypeOf<CloseEvent>();
        });
        ws.on("statechange", ({ current }) => {
            expectTypeOf(current).toMatchTypeOf<string>();
        });
    });
});
