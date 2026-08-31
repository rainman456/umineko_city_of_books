import { describe, expect, it } from "vitest";
import {
    keepLatestSamples,
    latencyGrade,
    medianLatency,
    LATENCY_FAIR_MS,
    LATENCY_POOR_MS,
    LATENCY_SAMPLES,
} from "./latency";

describe("latencyGrade", () => {
    it("grades a local connection as good", () => {
        // given / when / then
        expect(latencyGrade(0)).toBe("good");
        expect(latencyGrade(LATENCY_FAIR_MS - 1)).toBe("good");
    });

    it("grades a connection that is starting to hurt as fair", () => {
        // given / when / then
        expect(latencyGrade(LATENCY_FAIR_MS)).toBe("fair");
        expect(latencyGrade(LATENCY_POOR_MS - 1)).toBe("fair");
    });

    it("grades a connection past the paddle's reach as poor", () => {
        // given / when / then
        expect(latencyGrade(LATENCY_POOR_MS)).toBe("poor");
        expect(latencyGrade(400)).toBe("poor");
    });
});

describe("medianLatency", () => {
    it("reports nothing before any sample has landed", () => {
        // given / when
        const median = medianLatency([]);

        // then
        expect(median).toBeNull();
    });

    it("takes the middle of an odd run", () => {
        // given / when
        const median = medianLatency([30, 200, 40]);

        // then
        expect(median).toBe(40);
    });

    it("averages the middle pair of an even run", () => {
        // given / when
        const median = medianLatency([30, 50, 40, 200]);

        // then
        expect(median).toBe(45);
    });

    it("ignores a single spike rather than being dragged by it", () => {
        // given
        const steady = [40, 42, 41, 39, 900];

        // when
        const median = medianLatency(steady);

        // then
        expect(median).toBe(41);
    });

    it("leaves the caller's array untouched", () => {
        // given
        const samples = [30, 10, 20];

        // when
        medianLatency(samples);

        // then
        expect(samples).toEqual([30, 10, 20]);
    });
});

describe("keepLatestSamples", () => {
    it("appends while there is room", () => {
        // given / when
        const kept = keepLatestSamples([10, 20], 30);

        // then
        expect(kept).toEqual([10, 20, 30]);
    });

    it("drops the oldest once the window is full", () => {
        // given
        const full = Array.from({ length: LATENCY_SAMPLES }, (_unused, index) => index);

        // when
        const kept = keepLatestSamples(full, 99);

        // then
        expect(kept).toHaveLength(LATENCY_SAMPLES);
        expect(kept[0]).toBe(1);
        expect(kept[kept.length - 1]).toBe(99);
    });
});
