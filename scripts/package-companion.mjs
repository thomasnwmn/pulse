import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const config = JSON.parse(await readFile(new URL("../companion/config.json", import.meta.url), "utf8"));
const args = process.argv.slice(2);
const dashboard = new URL(args.includes("--url") ? args[args.indexOf("--url") + 1] : config.dashboardUrl);
const development = args.includes("--development");
if (dashboard.username || dashboard.password || dashboard.search || dashboard.hash || dashboard.pathname !== "/" || (dashboard.protocol !== "https:" && !(development && dashboard.protocol === "http:" && ["127.0.0.1", "localhost"].includes(dashboard.hostname)))) throw new Error("Use an exact HTTPS website origin, or --development --url http://127.0.0.1:3000 for testing.");
if (!["darwin", "linux"].includes(process.platform)) throw new Error("Packaging currently supports macOS and Linux.");
const origin = dashboard.origin;
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const platform = process.platform === "darwin" ? "macos" : "linux";
const arch = process.arch;
const stem = `pulse-companion-${platform}-${arch}${development ? "-development" : ""}-${version}`;
// Stage apps outside synced folders: file providers can attach Finder metadata
// between xattr cleanup and codesign, invalidating an otherwise clean bundle.
const build = await mkdtemp(join(tmpdir(), "pulse-package-"));
await mkdir("public/downloads", { recursive: true });
function run(command, argv) {
  const result = spawnSync(command, argv, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
run("cmake", ["-S", "daemon", "-B", "daemon/build", "-DCMAKE_BUILD_TYPE=Release", ...(platform === "macos" ? ["-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0"] : [])]);
run("cmake", ["--build", "daemon/build", "--parallel"]);
let signed = false, filename;
if (platform === "macos") {
  const app = resolve(build, "Pulse Companion.app");
  const macos = resolve(app, "Contents/MacOS"), resources = resolve(app, "Contents/Resources");
  await mkdir(macos, { recursive: true }); await mkdir(resources, { recursive: true });
  await copyFile("daemon/build/telemetryd", resolve(resources, "telemetryd"));
  // Keep the compiler's cache in the workspace, including in sandboxed builds.
  const cache = resolve("companion/build/module-cache"); await mkdir(cache, { recursive: true });
  run("xcrun", ["swiftc", "companion/macos/main.swift", "-O", "-target", `${arch === "arm64" ? "arm64" : "x86_64"}-apple-macosx13.0`, "-framework", "AppKit", "-module-cache-path", cache, "-o", resolve(macos, "PulseCompanion")]);
  await writeFile(resolve(app, "Contents/Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>ca.thomasnewman.pulse.companion</string>
<key>CFBundleName</key><string>Pulse Companion</string>
<key>CFBundleExecutable</key><string>PulseCompanion</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>${version}</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
<key>PulseDashboardURL</key><string>${origin}</string>
</dict></plist>`);
  run("xattr", ["-cr", app]);
  const identity = process.env.PULSE_CODESIGN_IDENTITY;
  if (identity && !development) {
    run("codesign", ["--force", "--timestamp", "--options", "runtime", "--sign", identity, resolve(resources, "telemetryd")]);
    run("codesign", ["--force", "--timestamp", "--options", "runtime", "--sign", identity, app]);
  } else {
    run("codesign", ["--force", "--sign", "-", resolve(resources, "telemetryd")]);
    run("codesign", ["--force", "--sign", "-", app]);
  }
  run("codesign", ["--verify", "--strict", app]);
  // Notarization is required before labeling a public Mac download as signed.
  filename = `${stem}.zip`;
  const archive = resolve("public/downloads", filename);
  run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, archive]);
  if (identity && !development && process.env.PULSE_NOTARY_PROFILE) {
    run("xcrun", ["notarytool", "submit", archive, "--keychain-profile", process.env.PULSE_NOTARY_PROFILE, "--wait"]);
    run("xcrun", ["stapler", "staple", app]);
    run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, archive]);
    signed = true;
  }
} else {
  const folder = resolve(build, "pulse-companion"); await mkdir(folder);
  await copyFile("daemon/build/telemetryd", resolve(folder, "telemetryd"));
  await writeFile(resolve(folder, "start.sh"), `#!/bin/sh\ncd -- "$(dirname -- "$0")" || exit 1\nexec ./telemetryd --allow-origin '${origin}'\n`, { mode: 0o755 });
  await writeFile(resolve(folder, "README.txt"), `Pulse Companion ${version}\nRun ./start.sh, keep it open, and visit ${origin}. Enter the PAIRING_CODE printed in the terminal. Ctrl+C stops collection.\n`);
  filename = `${stem}.tar.gz`;
  run("tar", ["-czf", resolve("public/downloads", filename), "-C", build, "pulse-companion"]);
}
const bytes = await readFile(resolve("public/downloads", filename));
const manifestFile = resolve("public/downloads/manifest.json");
const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
const entry = { label: `${platform === "macos" ? "Mac" : "Linux"} · ${arch === "arm64" ? platform === "macos" ? "Apple Silicon" : "ARM64" : "Intel / x64"}`, url: `/downloads/${filename}`, origin, version, platform, arch, signed, development, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
manifest.releases = manifest.releases.filter(release => (development || !release.development) && !(release.platform === platform && release.arch === arch && release.development === development));
manifest.releases.push(entry);
await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
await rm(build, { recursive: true, force: true });
console.log(`Packaged ${filename} for ${origin}${signed ? " (signed and notarized)" : " (development distribution; not notarized)"}`);
