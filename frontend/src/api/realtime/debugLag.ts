const STORAGE_KEY = "debug.realtimeLagMs";
const MAX_LAG_MS = 5000;

function read(): number {
    if (!import.meta.env.DEV) {
        return 0;
    }

    try {
        const fromQuery = new URLSearchParams(window.location.search).get("lag");
        if (fromQuery !== null) {
            window.sessionStorage.setItem(STORAGE_KEY, fromQuery);
        }

        const raw = window.sessionStorage.getItem(STORAGE_KEY);
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return 0;
        }

        return Math.min(parsed, MAX_LAG_MS);
    } catch {
        return 0;
    }
}

const roundTripMs = read();

export function debugLagMs(): number {
    return roundTripMs;
}

export function afterDebugLag(run: () => void): void {
    if (roundTripMs <= 0) {
        run();
        return;
    }

    window.setTimeout(run, roundTripMs / 2);
}
