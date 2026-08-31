import { useEffect, useRef, useState } from "react";
import { sendRealtime } from "../api/realtime/outbound";
import { useRealtimeEvent, useRealtimeStatus } from "../api/realtime/useRealtime";
import { keepLatestSamples, latencyGrade, medianLatency, type LatencyGrade } from "../domain/games/latency";

const PROBE_INTERVAL_MS = 1000;
const PROBE_TIMEOUT_MS = 5000;

export interface ServerPing {
    roundTripMs: number | null;
    grade: LatencyGrade | null;
}

export function useServerPing(enabled: boolean): ServerPing {
    const epoch = useRealtimeStatus();
    const [roundTripMs, setRoundTripMs] = useState<number | null>(null);

    const samplesRef = useRef<number[]>([]);
    const pendingRef = useRef(new Map<number, number>());
    const reportedRef = useRef(0);
    const nonceRef = useRef(0);

    useRealtimeEvent("pong", event => {
        const nonce = event.data?.nonce;
        if (typeof nonce !== "number") {
            return;
        }

        const sentAt = pendingRef.current.get(nonce);
        if (sentAt === undefined) {
            return;
        }

        pendingRef.current.delete(nonce);
        samplesRef.current = keepLatestSamples(samplesRef.current, Math.max(0, performance.now() - sentAt));

        const median = medianLatency(samplesRef.current);
        reportedRef.current = median === null ? 0 : Math.round(median);
        setRoundTripMs(median);
    });

    useEffect(() => {
        if (!enabled) {
            return;
        }

        samplesRef.current = [];
        pendingRef.current.clear();
        reportedRef.current = 0;

        const probe = () => {
            const now = performance.now();

            for (const [nonce, sentAt] of pendingRef.current) {
                if (now - sentAt > PROBE_TIMEOUT_MS) {
                    pendingRef.current.delete(nonce);
                }
            }

            nonceRef.current += 1;
            pendingRef.current.set(nonceRef.current, now);
            sendRealtime({ type: "ping", data: { nonce: nonceRef.current, rtt: reportedRef.current } });
        };

        probe();
        const timer = window.setInterval(probe, PROBE_INTERVAL_MS);

        return () => {
            window.clearInterval(timer);
        };
    }, [enabled, epoch]);

    return { roundTripMs, grade: roundTripMs === null ? null : latencyGrade(roundTripMs) };
}
