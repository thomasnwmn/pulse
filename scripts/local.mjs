import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
const executable = new URL("../daemon/build/telemetryd", import.meta.url);
if (!existsSync(executable)) { console.error("Build the native daemon first: npm run daemon:build"); process.exit(1); }
const daemon = spawn(executable.pathname, [], { stdio: "inherit" });
const require = createRequire(import.meta.url);
const web = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--hostname", "127.0.0.1"], { stdio: "inherit", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; daemon.kill("SIGTERM"); web.kill("SIGTERM"); process.exitCode = code; }
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
daemon.on("error", error => { console.error(error.message); stop(1); });
web.on("error", error => { console.error(error.message); stop(1); });
daemon.on("exit", code => { if (!stopping) stop(code || 1); });
web.on("exit", code => { if (!stopping) stop(code || 0); });
