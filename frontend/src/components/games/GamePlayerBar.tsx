import type { GameRoom } from "../../types/api";
import { formatDuration } from "./gameRoomHelpers";
import styles from "./GamePlayerBar.module.css";

interface GamePlayerBarProps {
    room: GameRoom;
    slot0Label: string;
    slot1Label: string;
    liveDurationSeconds: number;
    slot0Side?: "left" | "right";
}

export function GamePlayerBar({
    room,
    slot0Label,
    slot1Label,
    liveDurationSeconds,
    slot0Side = "right",
}: GamePlayerBarProps) {
    const slot0 = room.players.find(p => p.slot === 0);
    const slot1 = room.players.find(p => p.slot === 1);
    const isActive = room.status === "active";
    const slot0ToMove = isActive && slot0 !== undefined && room.turn_user_id === slot0.user_id;
    const slot1ToMove = isActive && slot1 !== undefined && room.turn_user_id === slot1.user_id;

    const leading = slot0Side === "left" ? slot0 : slot1;
    const leadingLabel = slot0Side === "left" ? slot0Label : slot1Label;
    const leadingToMove = slot0Side === "left" ? slot0ToMove : slot1ToMove;

    const trailing = slot0Side === "left" ? slot1 : slot0;
    const trailingLabel = slot0Side === "left" ? slot1Label : slot0Label;
    const trailingToMove = slot0Side === "left" ? slot1ToMove : slot0ToMove;

    return (
        <div className={styles.status}>
            <div className={styles.statusLeft}>
                <span className={`${styles.playerDot} ${leading?.connected ? styles.playerDotOn : ""}`} />
                <span className={styles.playerName}>{leading?.display_name ?? leadingLabel}</span>
                <span className={styles.colourLabel}>({leadingLabel})</span>
                <span className={`${styles.turnMarker} ${leadingToMove ? styles.turnMarkerActive : ""}`}>
                    {leadingToMove ? "to move" : ""}
                </span>
            </div>
            <div className={styles.statusCenter}>
                <span className={styles.watcherCount} title="Spectators watching">
                    👁 {room.watcher_count}
                </span>
                <span className={styles.watcherCount} title="Game duration">
                    ⏱ {formatDuration(liveDurationSeconds)}
                </span>
            </div>
            <div className={styles.statusRight}>
                <span className={`${styles.turnMarker} ${trailingToMove ? styles.turnMarkerActive : ""}`}>
                    {trailingToMove ? "to move" : ""}
                </span>
                <span className={styles.colourLabel}>({trailingLabel})</span>
                <span className={styles.playerName}>{trailing?.display_name ?? trailingLabel}</span>
                <span className={`${styles.playerDot} ${trailing?.connected ? styles.playerDotOn : ""}`} />
            </div>
        </div>
    );
}
