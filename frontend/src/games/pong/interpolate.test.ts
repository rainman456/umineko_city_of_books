import { describe, expect, it } from "vitest";
import {
    projectBall,
    pushFrame,
    sampleAt,
    sampleHistory,
    serverNow,
    smoothTowards,
    type BufferedFrame,
    type PongCourtBounds,
} from "./interpolate";
import {
    PONG_BUFFER,
    PONG_EVENT_HIT_P0,
    PONG_EVENT_SCORE,
    PONG_EXTRAPOLATE_MAX_MS,
    PONG_STALE_MS,
    type PongFrame,
} from "./types";

const bounds: PongCourtBounds = {
    height: 800,
    ballRadius: 10,
    paddleHeight: 130,
    faceX0: 58,
    faceX1: 1142,
};

function makeFrame(t: number, overrides: Partial<PongFrame> = {}): PongFrame {
    return {
        room_id: "room-1",
        t,
        phase: "rally",
        ball_x: 0,
        ball_y: 0,
        ball_vx: 0,
        ball_vy: 0,
        paddle_y: [400, 400],
        scores: [0, 0],
        ack: [0, 0],
        ping: [0, 0],
        connected: [true, true],
        serve_in_ms: 0,
        events: 0,
        ...overrides,
    };
}

function buffered(frames: PongFrame[], receivedAt = 1000): BufferedFrame[] {
    return frames.map((frame, index) => ({
        frame,
        receivedAt: receivedAt + index * 50,
        offset: frame.t - (receivedAt + index * 50),
    }));
}

describe("pushFrame", () => {
    it("appends a newer frame to the buffer", () => {
        // given
        const buf = buffered([makeFrame(0)]);

        // when
        const next = pushFrame(buf, makeFrame(50), 1050);

        // then
        expect(next).toHaveLength(2);
        expect(next[1].frame.t).toBe(50);
        expect(next[1].receivedAt).toBe(1050);
    });

    it("caps the ring at the buffer size and keeps the newest frames", () => {
        // given
        let buf: BufferedFrame[] = [];

        // when
        for (let i = 0; i < PONG_BUFFER + 3; i += 1) {
            buf = pushFrame(buf, makeFrame(i * 50), 1000 + i * 50);
        }

        // then
        expect(buf).toHaveLength(PONG_BUFFER);
        expect(buf[0].frame.t).toBe(3 * 50);
        expect(buf[buf.length - 1].frame.t).toBe((PONG_BUFFER + 2) * 50);
    });

    it("ignores a duplicate of the newest frame", () => {
        // given
        const buf = buffered([makeFrame(0), makeFrame(50)]);

        // when
        const next = pushFrame(buf, makeFrame(50), 1100);

        // then
        expect(next).toBe(buf);
    });

    it("snaps to a single frame when the previous one is older than the stale window", () => {
        // given
        const buf = buffered([makeFrame(0, { ball_x: 10 }), makeFrame(50, { ball_x: 20 })]);

        // when
        const next = pushFrame(buf, makeFrame(4000, { ball_x: 900 }), 1050 + PONG_STALE_MS + 1);

        // then
        expect(next).toHaveLength(1);
        expect(next[0].frame.ball_x).toBe(900);
    });

    it("snaps to a single frame when the clock runs backwards after a restart", () => {
        // given
        const buf = buffered([makeFrame(9000)]);

        // when
        const next = pushFrame(buf, makeFrame(0), 1010);

        // then
        expect(next).toHaveLength(1);
        expect(next[0].frame.t).toBe(0);
    });
});

describe("serverNow", () => {
    it("projects the newest frame time by the elapsed wall clock", () => {
        // given
        const buf: BufferedFrame[] = [{ frame: makeFrame(500), receivedAt: 1000, offset: -500 }];

        // when
        const now = serverNow(buf, 1030);

        // then
        expect(now).toBe(530);
    });

    it("reports zero for an empty buffer", () => {
        // given
        const buf: BufferedFrame[] = [];

        // when
        const now = serverNow(buf, 1234);

        // then
        expect(now).toBe(0);
    });

    it("never rewinds the render clock while arrivals jitter", () => {
        // given
        const latencies = [60, 90, 60, 100, 65, 110, 70, 95, 60, 105];
        const arrivals = latencies.map((lag, index) => ({ frame: makeFrame(index * 50), at: 2000 + index * 50 + lag }));
        let buf: BufferedFrame[] = [];
        let pending = 0;
        let previous = Number.NEGATIVE_INFINITY;
        const rewinds: number[] = [];

        // when
        for (let now = 2000; now <= 2600; now += 16) {
            while (pending < arrivals.length && arrivals[pending].at <= now) {
                buf = pushFrame(buf, arrivals[pending].frame, arrivals[pending].at);
                pending += 1;
            }
            if (buf.length === 0) {
                continue;
            }

            const renderT = serverNow(buf, now);
            if (renderT < previous) {
                rewinds.push(renderT);
            }
            previous = renderT;
        }

        // then
        expect(pending).toBe(arrivals.length);
        expect(rewinds).toEqual([]);
    });

    it("absorbs a single late arrival instead of stepping the whole way back", () => {
        // given
        const steady = pushFrame(pushFrame([], makeFrame(1000), 2000), makeFrame(1050), 2050);

        // when
        const late = pushFrame(steady, makeFrame(1100), 2190);

        // then
        expect(serverNow(steady, 2190)).toBeCloseTo(1190, 6);
        expect(serverNow(late, 2190)).toBeGreaterThan(1180);
    });

    it("snaps the render clock back to the server when the server restarts", () => {
        // given
        const buf = pushFrame(pushFrame([], makeFrame(9000), 2000), makeFrame(9050), 2050);

        // when
        const restarted = pushFrame(buf, makeFrame(0), 2100);

        // then
        expect(serverNow(restarted, 2100)).toBe(0);
        expect(serverNow(restarted, 2140)).toBe(40);
    });

    it("snaps the render clock forward after a stale gap", () => {
        // given
        const buf = pushFrame([], makeFrame(1000), 2000);

        // when
        const revived = pushFrame(buf, makeFrame(9000), 2000 + PONG_STALE_MS + 1);

        // then
        expect(serverNow(revived, 2000 + PONG_STALE_MS + 1)).toBe(9000);
    });
});

describe("projectBall", () => {
    it("carries the ball forward along its velocity", () => {
        // given
        const frame = makeFrame(0, { ball_x: 600, ball_y: 400, ball_vx: 900, ball_vy: 300 });

        // when
        const projected = projectBall(frame, 100, bounds);

        // then
        expect(projected.x).toBeCloseTo(690, 6);
        expect(projected.y).toBeCloseTo(430, 6);
    });

    it("reflects off the top and bottom walls the way the server does", () => {
        // given
        const upward = makeFrame(0, { ball_x: 600, ball_y: 40, ball_vx: 900, ball_vy: -600 });
        const downward = makeFrame(0, { ball_x: 600, ball_y: 760, ball_vx: 900, ball_vy: 600 });

        // when
        const top = projectBall(upward, 100, bounds);
        const floor = projectBall(downward, 100, bounds);

        // then
        expect(top.y).toBeCloseTo(40, 6);
        expect(floor.y).toBeCloseTo(760, 6);
    });

    it("holds the ball at the paddle face while a hit is still unconfirmed", () => {
        // given
        const frame = makeFrame(0, { ball_x: 120, ball_y: 400, ball_vx: -1400, ball_vy: 0, paddle_y: [400, 400] });

        // when
        const projected = projectBall(frame, 150, bounds);

        // then
        expect(projected.x).toBe(bounds.faceX0 + bounds.ballRadius);
    });

    it("lets the ball run past a paddle that cannot reach it", () => {
        // given
        const frame = makeFrame(0, { ball_x: 120, ball_y: 400, ball_vx: -1400, ball_vy: 0, paddle_y: [100, 400] });

        // when
        const projected = projectBall(frame, 150, bounds);

        // then
        expect(projected.x).toBeLessThan(bounds.faceX0);
    });

    it("stops projecting once the extrapolation cap is reached", () => {
        // given
        const frame = makeFrame(0, { ball_x: 600, ball_y: 400, ball_vx: 900, ball_vy: 0 });

        // when
        const capped = projectBall(frame, PONG_EXTRAPOLATE_MAX_MS + 500, bounds);

        // then
        expect(capped.x).toBeCloseTo(600 + 900 * (PONG_EXTRAPOLATE_MAX_MS / 1000), 6);
    });

    it("leaves the ball still outside a rally", () => {
        // given
        const frame = makeFrame(0, { phase: "serve", ball_x: 600, ball_y: 400, ball_vx: 900, ball_vy: 300 });

        // when
        const projected = projectBall(frame, 100, bounds);

        // then
        expect(projected).toEqual({ x: 600, y: 400 });
    });
});

describe("sampleHistory", () => {
    const history = [
        { at: 1000, y: 100 },
        { at: 1050, y: 200 },
        { at: 1100, y: 300 },
    ];

    it("falls back while nothing has been recorded", () => {
        // given / when
        const y = sampleHistory([], 1000, 42);

        // then
        expect(y).toBe(42);
    });

    it("reads back where the paddle was at a moment in the past", () => {
        // given / when
        const y = sampleHistory(history, 1025, 0);

        // then
        expect(y).toBe(150);
    });

    it("lands exactly on a recorded moment", () => {
        // given / when
        const y = sampleHistory(history, 1050, 0);

        // then
        expect(y).toBe(200);
    });

    it("holds the newest entry rather than guessing ahead of it", () => {
        // given / when
        const y = sampleHistory(history, 9000, 0);

        // then
        expect(y).toBe(300);
    });

    it("holds the oldest entry when asked for a moment it no longer remembers", () => {
        // given / when
        const y = sampleHistory(history, 0, 0);

        // then
        expect(y).toBe(100);
    });
});

describe("smoothTowards", () => {
    it("covers half the gap in one half-life", () => {
        // given / when
        const eased = smoothTowards(0, 100, 30, 30);

        // then
        expect(eased).toBeCloseTo(50, 6);
    });

    it("snaps straight to the target when no time has passed", () => {
        // given / when
        const eased = smoothTowards(0, 100, 0, 30);

        // then
        expect(eased).toBe(100);
    });
});

describe("sampleAt", () => {
    it("returns nothing for an empty buffer", () => {
        // given
        const buf: BufferedFrame[] = [];

        // when
        const sample = sampleAt(buf, 0, bounds);

        // then
        expect(sample).toBeNull();
    });

    it("lerps the ball and both paddles between the bracketing pair", () => {
        // given
        const buf = buffered([
            makeFrame(0, { ball_x: 0, ball_y: 100, paddle_y: [100, 200] }),
            makeFrame(50, { ball_x: 100, ball_y: 300, paddle_y: [200, 400] }),
        ]);

        // when
        const sample = sampleAt(buf, 25, bounds);

        // then
        expect(sample?.ballX).toBe(50);
        expect(sample?.ballY).toBe(200);
        expect(sample?.paddleY).toEqual([150, 300]);
    });

    it("extrapolates the ball past the newest frame so it is drawn at the present moment", () => {
        // given
        const buf = buffered([makeFrame(0, { ball_x: 500 }), makeFrame(50, { ball_x: 600, ball_vx: 900 })]);

        // when
        const sample = sampleAt(buf, 150, bounds);

        // then
        expect(sample?.ballX).toBeCloseTo(690, 6);
        expect(sample?.t).toBe(150);
    });

    it("holds both paddles at their newest position rather than extrapolating them", () => {
        // given
        const buf = buffered([makeFrame(0, { paddle_y: [100, 200] }), makeFrame(50, { paddle_y: [300, 500] })]);

        // when
        const sample = sampleAt(buf, 150, bounds);

        // then
        expect(sample?.paddleY).toEqual([300, 500]);
    });

    it("counts the serve clock down while it runs ahead of the newest frame", () => {
        // given
        const buf = buffered([makeFrame(50, { phase: "serve", serve_in_ms: 1200 })]);

        // when
        const sample = sampleAt(buf, 250, bounds);

        // then
        expect(sample?.serveInMs).toBe(1000);
    });

    it("holds the oldest frame when the render clock sits before it", () => {
        // given
        const buf = buffered([makeFrame(100, { ball_x: 60 }), makeFrame(150, { ball_x: 160 })]);

        // when
        const sample = sampleAt(buf, 20, bounds);

        // then
        expect(sample?.ballX).toBe(60);
    });

    it("renders a lone frame directly", () => {
        // given
        const buf = buffered([makeFrame(0, { ball_x: 42, ball_y: 84 })]);

        // when
        const sample = sampleAt(buf, 0, bounds);

        // then
        expect(sample?.ballX).toBe(42);
        expect(sample?.ballY).toBe(84);
    });

    it("steps the scores, phase and serve countdown rather than lerping them", () => {
        // given
        const buf = buffered([
            makeFrame(0, { scores: [1, 0], phase: "rally", serve_in_ms: 0 }),
            makeFrame(50, { scores: [1, 1], phase: "serve", serve_in_ms: 1200 }),
        ]);

        // when
        const sample = sampleAt(buf, 40, bounds);

        // then
        expect(sample?.scores).toEqual([1, 0]);
        expect(sample?.phase).toBe("rally");
        expect(sample?.serveInMs).toBe(0);
    });

    it("collects the events of every frame the render clock has passed", () => {
        // given
        const buf = buffered([
            makeFrame(0),
            makeFrame(50, { events: PONG_EVENT_HIT_P0 }),
            makeFrame(100, { events: PONG_EVENT_SCORE }),
        ]);

        // when
        const early = sampleAt(buf, 60, bounds);
        const late = sampleAt(buf, 120, bounds);

        // then
        expect(early?.events).toEqual([{ t: 50, events: PONG_EVENT_HIT_P0 }]);
        expect(late?.events).toEqual([
            { t: 50, events: PONG_EVENT_HIT_P0 },
            { t: 100, events: PONG_EVENT_SCORE },
        ]);
    });

    it("reports a fresh buffer as not stale", () => {
        // given
        const buf = buffered([makeFrame(0), makeFrame(50)]);

        // when
        const sample = sampleAt(buf, 100, bounds);

        // then
        expect(sample?.stale).toBe(false);
    });

    it("reports the buffer as stale once the render clock outruns the newest frame", () => {
        // given
        const buf = buffered([makeFrame(0), makeFrame(50)]);

        // when
        const sample = sampleAt(buf, 50 + PONG_STALE_MS + 1, bounds);

        // then
        expect(sample?.stale).toBe(true);
    });

    it("snaps to the fresh position on the first frame after a stale gap", () => {
        // given
        const stale = buffered([makeFrame(0, { ball_x: 0 }), makeFrame(50, { ball_x: 100 })]);

        // when
        const revived = pushFrame(stale, makeFrame(5000, { ball_x: 900 }), 1050 + PONG_STALE_MS + 1);
        const sample = sampleAt(revived, 5000, bounds);

        // then
        expect(sample?.ballX).toBe(900);
        expect(sample?.stale).toBe(false);
    });
});
