import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineStore } from "../src/helpers/store";

// Define a type for the message
type Message = { text: string };

const initialState = {
    messages: [] as Message[] // Explicitly type the messages array
};

describe("Store", () => {
    let store: ReturnType<typeof defineStore<typeof initialState>>;

    beforeEach(() => {
        store = defineStore<typeof initialState>(initialState);
    });

    it("should return the initial state", () => {
        expect(store.getState()).toEqual(initialState);
    });

    it("should update state on dispatch", () => {
        const message: Message = { text: "Hello, world!" };
        store.defineAction(
            "ADD_MESSAGE",
            (state: typeof initialState, payload: unknown) => {
                const message = payload as Message; // Cast payload to Message
                return { ...state, messages: [...state.messages, message] };
            }
        );
        store.dispatch("ADD_MESSAGE", message);
        expect(store.getState().messages).toContain(message);
    });

    it("should not update state for unknown action", () => {
        const prevState = store.getState();
        store.dispatch("UNKNOWN_ACTION");
        expect(store.getState()).toEqual(prevState);
    });

    it("should emit events on state change", () => {
        const message: Message = { text: "Hello, world!" };
        const onStateChanged = vi.fn();
        store.on("state-changed", onStateChanged);

        store.defineAction("ADD_MESSAGE", (state, payload: unknown) => {
            const message = payload as Message; // Cast payload to Message
            return { ...state, messages: [...state.messages, message] };
        });

        store.dispatch("ADD_MESSAGE", message);

        expect(onStateChanged).toHaveBeenCalledWith({
            type: "ADD_MESSAGE",
            state: store.getState()
        });
    });

    it("should allow unsubscribing from events", () => {
        const onStateChanged = vi.fn();
        store.on("state-changed", onStateChanged);

        store.defineAction("ADD_MESSAGE", (state, payload: unknown) => {
            const message = payload as Message; // Cast payload to Message
            return { ...state, messages: [...state.messages, message] };
        });

        store.dispatch("ADD_MESSAGE", { text: "Hello, world!" });
        store.off("state-changed", onStateChanged);

        store.dispatch("ADD_MESSAGE", { text: "Another message" });

        expect(onStateChanged).toHaveBeenCalledTimes(1);
    });

    it("should execute middleware in order", async () => {
        const middleware1 = vi.fn((_ctx, next) => next());
        const middleware2 = vi.fn((_ctx, next) => next());

        store.use(middleware1, middleware2);

        store.defineAction("NO_OP", (state) => state);
        await store.dispatch("NO_OP");

        // Check the order of calls
        expect(middleware1.mock.invocationCallOrder[0]).toBeLessThan(
            middleware2.mock.invocationCallOrder[0]
        );
    });

    it("should not change state if handler returns void", () => {
        const prevState = store.getState();
        store.defineAction("NO_OP", () => {});
        store.dispatch("NO_OP");
        expect(store.getState()).toEqual(prevState);
    });

    it("should execute multiple handlers for the same action", () => {
        const handler1 = vi.fn((state) => ({
            ...state,
            messages: [...state.messages, { text: "Handler 1" }]
        }));
        const handler2 = vi.fn((state) => ({
            ...state,
            messages: [...state.messages, { text: "Handler 2" }]
        }));

        store.defineAction("MULTI_HANDLER", handler1);
        store.defineAction("MULTI_HANDLER", handler2);

        store.dispatch("MULTI_HANDLER");

        expect(handler1).toHaveBeenCalled();
        expect(handler2).toHaveBeenCalled();
        expect(store.getState().messages).toEqual([
            { text: "Handler 1" },
            { text: "Handler 2" }
        ]);
    });

    it("should handle async middleware with next()", async () => {
        const middleware = vi.fn(async (_ctx, next) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return next();
        });

        store.use(middleware);

        store.defineAction("ASYNC_ACTION", (state) => ({
            ...state,
            messages: [...state.messages, { text: "Async Action" }]
        }));

        await store.dispatch("ASYNC_ACTION");

        expect(middleware).toHaveBeenCalled();
        expect(store.getState().messages).toContainEqual({
            text: "Async Action"
        });
    });

    it("should handle async middleware with await next()", async () => {
        const middleware = vi.fn(async (_ctx, next) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            await next();
        });

        store.use(middleware);

        store.defineAction("ASYNC_ACTION", (state) => ({
            ...state,
            messages: [...state.messages, { text: "Async Action" }]
        }));

        await store.dispatch("ASYNC_ACTION");

        expect(middleware).toHaveBeenCalled();
        expect(store.getState().messages).toContainEqual({
            text: "Async Action"
        });
    });

    it("should handle errors in action handlers", async () => {
        store.defineAction("ERROR_ACTION", () => {
            throw new Error("Handler error");
        });

        await expect(store.dispatch("ERROR_ACTION")).rejects.toThrow(
            "Handler error"
        );
    });

    it("should handle errors in middleware", async () => {
        const errorMiddleware = vi.fn(() => {
            throw new Error("Middleware error");
        });

        store.use(errorMiddleware);

        store.defineAction("ERROR_ACTION", (state) => state);

        await expect(store.dispatch("ERROR_ACTION")).rejects.toThrow(
            "Middleware error"
        );
    });
});
