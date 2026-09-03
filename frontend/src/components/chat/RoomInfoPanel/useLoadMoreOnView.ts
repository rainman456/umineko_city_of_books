import { useEffect, useRef } from "react";

interface LoadMoreOptions {
    hasMore: boolean;
    loadingMore: boolean;
    loadMore: () => void;
}

export function useLoadMoreOnView({ hasMore, loadingMore, loadMore }: LoadMoreOptions) {
    const sentinelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const node = sentinelRef.current;
        if (!node || !hasMore || loadingMore) {
            return;
        }

        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) {
                loadMore();
            }
        });

        observer.observe(node);

        return () => {
            observer.disconnect();
        };
    }, [hasMore, loadingMore, loadMore]);

    return sentinelRef;
}
