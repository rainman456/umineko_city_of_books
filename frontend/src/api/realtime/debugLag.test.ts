import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function load(search: string, stored: string | null) {
    vi.resetModules();
    window.sessionStorage.clear();
    if (stored !== null) {
        window.sessionStorage.setItem("debug.realtimeLagMs", stored);
    }
    window.history.replaceState(null, "", `/games/pong/room-1${search}`);

    return import("./debugLag");
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
});

describe("debugLag", () => {
    it("stays off when nothing asks for it", async () => {
        // given
        const { debugLagMs, afterDebugLag } = await load("", null);
        const run = vi.fn();

        // when
        afterDebugLag(run);

        // then
        expect(debugLagMs()).toBe(0);
        expect(run).toHaveBeenCalledOnce();
    });

    it("runs straight away when off, without waiting for a timer", async () => {
        // given
        const { afterDebugLag } = await load("", null);
        const order: string[] = [];

        // when
        afterDebugLag(() => order.push("delayed"));
        order.push("after");

        // then
        expect(order).toEqual(["delayed", "after"]);
    });

    it("picks the lag up from the query string", async () => {
        // given / when
        const { debugLagMs } = await load("?lag=300", null);

        // then
        expect(debugLagMs()).toBe(300);
    });

    it("remembers the lag for the rest of the tab's session", async () => {
        // given / when
        const { debugLagMs } = await load("", "300");

        // then
        expect(debugLagMs()).toBe(300);
    });

    it("splits the round trip across the two directions", async () => {
        // given
        const { afterDebugLag } = await load("?lag=300", null);
        const run = vi.fn();

        // when
        afterDebugLag(run);
        vi.advanceTimersByTime(149);

        // then
        expect(run).not.toHaveBeenCalled();

        // when
        vi.advanceTimersByTime(1);

        // then
        expect(run).toHaveBeenCalledOnce();
    });

    it("caps an absurd value rather than freezing the socket", async () => {
        // given / when
        const { debugLagMs } = await load("?lag=99999999", null);

        // then
        expect(debugLagMs()).toBe(5000);
    });

    it("ignores a value that is not a positive number", async () => {
        // given / when
        const nonsense = await load("?lag=banana", null);
        const negative = await load("?lag=-50", null);

        // then
        expect(nonsense.debugLagMs()).toBe(0);
        expect(negative.debugLagMs()).toBe(0);
    });
});
