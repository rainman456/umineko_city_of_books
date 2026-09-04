import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_HOST = "10.0.2.2";
const PORT = 5173;

const arg = process.argv[2];
const host = arg ?? DEFAULT_HOST;
const url = host.startsWith("http") ? host : `http://${host}:${PORT}`;

if (!existsSync(resolve("dist-app"))) {
    console.log("dist-app not found, building it once first...");
    execSync("npm run build:app", { stdio: "inherit" });
}

console.log(`\nSyncing android for live-reload against: ${url}`);
console.log("Reminder: `npm run dev` (Vite :5173) and the backend (:4323) must be running.\n");

const configPath = resolve("capacitor.config.json");
const pristine = readFileSync(configPath, "utf8");

try {
    const config = JSON.parse(pristine);
    config.server = { url, cleartext: true };
    writeFileSync(configPath, `${JSON.stringify(config, null, 4)}\n`);

    execSync("npx cap sync android", { stdio: "inherit" });
} finally {
    writeFileSync(configPath, pristine);
}

console.log("\nDone. Run the app from IntelliJ.");
console.log("Emulator uses 10.0.2.2 (default). For a physical device pass your PC's LAN IP:");
console.log("  npm run cap:local -- 192.168.50.134");
