import { PONG_BUFFER, PONG_EXTRAPOLATE_MAX_MS, PONG_STALE_MS, type PongFrame, type PongPhase } from "./types";

export interface BufferedFrame {
    frame: PongFrame;
    receivedAt: number;
    offset: number;
}

export interface PongCourtBounds {
    height: number;
    ballRadius: number;
    paddleHeight: number;
    faceX0: number;
    faceX1: number;
}

export interface PongEventAt {
    t: number;
    events: number;
}

export interface PongSample {
    t: number;
    phase: PongPhase;
    ballX: number;
    ballY: number;
    paddleY: [number, number];
    scores: [number, number];
    ack: [number, number];
    ping: [number, number];
    connected: [boolean, boolean];
    serveInMs: number;
    events: PongEventAt[];
    stale: boolean;
}

const OFFSET_SMOOTHING = 0.08;

function clamp01(value: number): number {
    if (value < 0) {
        return 0;
    }
    if (value > 1) {
        return 1;
    }
    return value;
}

function lerp(from: number, to: number, alpha: number): number {
    return from + (to - from) * alpha;
}

function foldIntoCourt(y: number, bounds: PongCourtBounds): number {
    const lo = bounds.ballRadius;
    const hi = bounds.height - bounds.ballRadius;
    if (hi <= lo) {
        return lo;
    }

    let folded = y;
    let guard = 0;
    while (guard < 8) {
        if (folded < lo) {
            folded = 2 * lo - folded;
        } else if (folded > hi) {
            folded = 2 * hi - folded;
        } else {
            return folded;
        }
        guard += 1;
    }

    return folded < lo ? lo : hi;
}

function holdAtFace(frame: PongFrame, x: number, y: number, bounds: PongCourtBounds): number {
    const reach = bounds.paddleHeight / 2 + bounds.ballRadius;

    if (frame.ball_vx < 0 && Math.abs(y - frame.paddle_y[0]) <= reach) {
        return Math.max(x, bounds.faceX0 + bounds.ballRadius);
    }

    if (frame.ball_vx > 0 && Math.abs(y - frame.paddle_y[1]) <= reach) {
        return Math.min(x, bounds.faceX1 - bounds.ballRadius);
    }

    return x;
}

export function projectBall(frame: PongFrame, aheadMs: number, bounds: PongCourtBounds): { x: number; y: number } {
    if (frame.phase !== "rally" || aheadMs <= 0) {
        return { x: frame.ball_x, y: frame.ball_y };
    }

    const dt = Math.min(aheadMs, PONG_EXTRAPOLATE_MAX_MS) / 1000;
    const y = foldIntoCourt(frame.ball_y + frame.ball_vy * dt, bounds);
    const x = frame.ball_x + frame.ball_vx * dt;

    return { x: holdAtFace(frame, x, y, bounds), y };
}

export interface TargetSample {
    at: number;
    y: number;
}

export function sampleHistory(history: readonly TargetSample[], at: number, fallback: number): number {
    if (history.length === 0) {
        return fallback;
    }

    const newest = history[history.length - 1];
    if (at >= newest.at) {
        return newest.y;
    }

    const oldest = history[0];
    if (at <= oldest.at) {
        return oldest.y;
    }

    for (let index = history.length - 1; index > 0; index -= 1) {
        const before = history[index - 1];
        if (before.at > at) {
            continue;
        }

        const after = history[index];
        const span = after.at - before.at;

        return span > 0 ? lerp(before.y, after.y, (at - before.at) / span) : before.y;
    }

    return oldest.y;
}

export function smoothTowards(current: number, target: number, elapsedMs: number, halfLifeMs: number): number {
    if (elapsedMs <= 0 || halfLifeMs <= 0) {
        return target;
    }

    return current + (target - current) * (1 - Math.pow(0.5, elapsedMs / halfLifeMs));
}

export function pushFrame(buf: BufferedFrame[], frame: PongFrame, now: number): BufferedFrame[] {
    const newest = buf.length > 0 ? buf[buf.length - 1] : null;
    const sampled = frame.t - now;

    if (!newest) {
        return [{ frame, receivedAt: now, offset: sampled }];
    }

    if (frame.t === newest.frame.t) {
        return buf;
    }
    if (frame.t < newest.frame.t || now - newest.receivedAt > PONG_STALE_MS) {
        return [{ frame, receivedAt: now, offset: sampled }];
    }

    const offset = newest.offset + (sampled - newest.offset) * OFFSET_SMOOTHING;

    const next = [...buf, { frame, receivedAt: now, offset }];
    if (next.length > PONG_BUFFER) {
        next.splice(0, next.length - PONG_BUFFER);
    }

    return next;
}

export function serverNow(buf: BufferedFrame[], now: number): number {
    if (buf.length === 0) {
        return 0;
    }

    return buf[buf.length - 1].offset + now;
}

export function sampleAt(buf: BufferedFrame[], renderT: number, bounds: PongCourtBounds): PongSample | null {
    if (buf.length === 0) {
        return null;
    }

    const newest = buf[buf.length - 1].frame;
    const stale = renderT - newest.t > PONG_STALE_MS;

    let base = -1;
    const crossed: PongEventAt[] = [];
    for (const [index, entry] of buf.entries()) {
        if (entry.frame.t > renderT) {
            continue;
        }
        base = index;
        if (entry.frame.events !== 0) {
            crossed.push({ t: entry.frame.t, events: entry.frame.events });
        }
    }

    const ahead = renderT - newest.t;
    if (ahead >= 0) {
        const ball = projectBall(newest, ahead, bounds);

        return {
            t: newest.t + Math.min(ahead, PONG_EXTRAPOLATE_MAX_MS),
            phase: newest.phase,
            ballX: ball.x,
            ballY: ball.y,
            paddleY: [newest.paddle_y[0], newest.paddle_y[1]],
            scores: [newest.scores[0], newest.scores[1]],
            ack: [newest.ack[0], newest.ack[1]],
            ping: [newest.ping?.[0] ?? 0, newest.ping?.[1] ?? 0],
            connected: [newest.connected[0], newest.connected[1]],
            serveInMs: Math.max(0, newest.serve_in_ms - ahead),
            events: crossed,
            stale,
        };
    }

    const anchor = base < 0 ? 0 : base;
    const a = buf[anchor].frame;
    const b = base >= 0 && base + 1 < buf.length ? buf[base + 1].frame : a;
    const span = b.t - a.t;
    const alpha = span > 0 ? clamp01((renderT - a.t) / span) : 0;

    return {
        t: lerp(a.t, b.t, alpha),
        phase: a.phase,
        ballX: lerp(a.ball_x, b.ball_x, alpha),
        ballY: lerp(a.ball_y, b.ball_y, alpha),
        paddleY: [lerp(a.paddle_y[0], b.paddle_y[0], alpha), lerp(a.paddle_y[1], b.paddle_y[1], alpha)],
        scores: [a.scores[0], a.scores[1]],
        ack: [a.ack[0], a.ack[1]],
        ping: [a.ping?.[0] ?? 0, a.ping?.[1] ?? 0],
        connected: [a.connected[0], a.connected[1]],
        serveInMs: a.serve_in_ms,
        events: crossed,
        stale,
    };
}
