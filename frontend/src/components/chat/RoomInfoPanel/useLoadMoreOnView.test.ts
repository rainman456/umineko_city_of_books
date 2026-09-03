import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLoadMoreOnView } from "./useLoadMoreOnView";

const observed: Element[] = [];
let trigger: (() => void) | null = null;

class FakeObserver {
    constructor(callback: IntersectionObserverCallback) {
        trigger = () => callback([{ isIntersecting: true } as IntersectionObserverEntry], this as never);
    }

    observe(node: Element) {
        observed.push(node);
    }

    disconnect() {}
}

beforeEach(() => {
    observed.length = 0;
    trigger = null;
    vi.stubGlobal("IntersectionObserver", FakeObserver);
});

function render(opts: { hasMore: boolean; loadingMore: boolean }) {
    const loadMore = vi.fn();
    const { result } = renderHook(() => useLoadMoreOnView({ ...opts, loadMore }));
    Object.defineProperty(result.current, "current", { value: document.createElement("div"), writable: true });

    return { loadMore, ref: result.current };
}

describe("useLoadMoreOnView", () => {
    it("does not observe anything when there is no more to load", () => {
        // given
        render({ hasMore: false, loadingMore: false });

        // then
        expect(observed).toHaveLength(0);
    });

    it("does not observe while a page is already in flight", () => {
        // given
        render({ hasMore: true, loadingMore: true });

        // then
        expect(observed).toHaveLength(0);
    });

    it("loads the next page once the sentinel comes into view", () => {
        // given
        const loadMore = vi.fn();
        const node = document.createElement("div");
        const { rerender } = renderHook(
            (props: { hasMore: boolean }) => {
                const ref = useLoadMoreOnView({ hasMore: props.hasMore, loadingMore: false, loadMore });
                ref.current = node;

                return ref;
            },
            { initialProps: { hasMore: false } },
        );

        // when the sentinel exists and there is more to fetch
        rerender({ hasMore: true });
        trigger?.();

        // then
        expect(loadMore).toHaveBeenCalled();
    });
});
