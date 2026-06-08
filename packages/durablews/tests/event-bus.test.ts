import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineEventBus } from "../src/helpers/event-bus";
import type { EventBus } from "../src/types";

describe("Event Bus", () => {
    let eventBus: EventBus;

    beforeEach(() => {
        eventBus = defineEventBus();
    });

    it("should register an event handler and emit an event", () => {
        const handler = vi.fn();
        eventBus.on("test", handler);

        eventBus.emit("test", "payload");

        expect(handler).toHaveBeenCalledWith("payload");
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should not call handler after it is removed", () => {
        const handler = vi.fn();
        eventBus.on("test", handler);
        eventBus.off("test", handler);

        eventBus.emit("test", "payload");

        expect(handler).not.toHaveBeenCalled();
    });

    it("should handle multiple handlers for the same event", () => {
        const handler1 = vi.fn();
        const handler2 = vi.fn();
        eventBus.on("test", handler1);
        eventBus.on("test", handler2);

        eventBus.emit("test", "payload");

        expect(handler1).toHaveBeenCalledWith("payload");
        expect(handler2).toHaveBeenCalledWith("payload");
        expect(handler1).toHaveBeenCalledTimes(1);
        expect(handler2).toHaveBeenCalledTimes(1);
    });

    it("should not fail if removing a non-existent handler", () => {
        const handler = vi.fn();
        eventBus.off("test", handler);

        eventBus.emit("test", "payload");

        expect(handler).not.toHaveBeenCalled();
    });

    it("should not call handlers for different events", () => {
        const handler = vi.fn();
        eventBus.on("test", handler);

        eventBus.emit("differentEvent", "payload");

        expect(handler).not.toHaveBeenCalled();
    });
});
