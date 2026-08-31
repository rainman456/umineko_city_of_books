import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as OutboundModule from "../api/realtime/outbound";
import { emitRealtimeEvent, makeWSHarness, type WSHarness } from "../test-utils/ws";
import { useServerPing } from "./useServerPing";

const holder = vi.hoisted(() => ({ ws: null as unknown as WSHarness }));

vi.mock("../api/realtime/pipeline", () => ({
    ensureRealtimePipeline: () => {},
    getRealtimeEpoch: () => holder.ws.getEpoch(),
    subscribeRealtimeEpoch: (listener: () => void) => holder.ws.subscribeEpoch(listener),
}));

vi.mock("../api/realtime/outbound", async importOriginal => {
    const actual = await importOriginal<typeof OutboundModule>();

    return { ...actual, sendRealtime: (command: OutboundModule.RealtimeCommand) => holder.ws.sendRealtime(command) };
});

let clock = 0;

function sentNonces(): number[] {
    return holder.ws.sendRealtime.mock.calls
        .map(([command]) => command)
        .filter(command => command.type === "ping")
        .map(command => (command.data as OutboundModule.PingPayload).nonce);
}

function answer(nonce: number, afterMs: number): void {
    clock += afterMs;
    emitRealtimeEvent({ type: "pong", data: { nonce } });
}

beforeEach(() => {
    holder.ws = makeWSHarness();
    clock = 0;
    vi.useFakeTimers();
    vi.stubGlobal("performance", { now: () => clock });
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("useServerPing", () => {
    it("probes the server as soon as it is enabled", () => {
        // given / when
        renderHook(() => useServerPing(true));

        // then
        expect(sentNonces()).toEqual([1]);
    });

    it("stays silent while it is disabled", () => {
        // given
        renderHook(() => useServerPing(false));

        // when
        act(() => {
            vi.advanceTimersByTime(5000);
        });

        // then
        expect(sentNonces()).toEqual([]);
    });

    it("keeps probing on a timer", () => {
        // given
        renderHook(() => useServerPing(true));

        // when
        act(() => {
            vi.advanceTimersByTime(2000);
        });

        // then
        expect(sentNonces()).toEqual([1, 2, 3]);
    });

    it("reports the round trip of the reply to its own probe", () => {
        // given
        const { result } = renderHook(() => useServerPing(true));

        // when
        answer(1, 40);

        // then
        expect(result.current.roundTripMs).toBe(40);
        expect(result.current.grade).toBe("good");
    });

    it("ignores a pong it never asked for, so the keepalive cannot fake a fast link", () => {
        // given
        const { result } = renderHook(() => useServerPing(true));

        // when
        answer(999, 1);

        // then
        expect(result.current.roundTripMs).toBeNull();
    });

    it("ignores a pong that carries no nonce", () => {
        // given
        const { result } = renderHook(() => useServerPing(true));

        // when
        clock += 5;
        emitRealtimeEvent({ type: "pong", data: {} });

        // then
        expect(result.current.roundTripMs).toBeNull();
    });

    it("reports the median rather than the latest sample", () => {
        // given
        const { result } = renderHook(() => useServerPing(true));

        // when
        answer(1, 200);
        act(() => {
            vi.advanceTimersByTime(1000);
        });
        answer(2, 200);
        act(() => {
            vi.advanceTimersByTime(1000);
        });
        answer(3, 900);

        // then
        expect(result.current.roundTripMs).toBe(200);
    });

    it("grades a distant link as poor", () => {
        // given
        const { result } = renderHook(() => useServerPing(true));

        // when
        answer(1, 240);

        // then
        expect(result.current.grade).toBe("poor");
    });

    it("stops probing once it is torn down", () => {
        // given
        const { unmount } = renderHook(() => useServerPing(true));

        // when
        unmount();
        act(() => {
            vi.advanceTimersByTime(5000);
        });

        // then
        expect(sentNonces()).toEqual([1]);
    });
});
