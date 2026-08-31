import type { LatencyGrade } from "../../domain/games/latency";
import styles from "./LatencyBanner.module.css";

interface LatencyBannerProps {
    roundTripMs: number | null;
    grade: LatencyGrade | null;
}

const COPY: Record<Exclude<LatencyGrade, "good">, string> = {
    fair: "Your connection to the game server is slow, so fast exchanges may be harder to react to.",
    poor: "Your connection to the game server is very slow. What you see is behind what the server has already decided, so aim ahead of it. This match may not be playable.",
};

export function LatencyBanner({ roundTripMs, grade }: LatencyBannerProps) {
    if (roundTripMs === null || grade === null || grade === "good") {
        return null;
    }

    return (
        <div className={`${styles.latencyBanner} ${styles[grade]}`} role="status">
            <span className={styles.reading}>{Math.round(roundTripMs)}ms</span> {COPY[grade]}
        </div>
    );
}
