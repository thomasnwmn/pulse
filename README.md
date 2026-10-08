# Pulse — System Telemetry

A Next.js dashboard you visit at **https://pulse.thomasnewman.ca**, paired with a downloadable native companion. Vercel serves the interface; a C++ collector streams your computer’s readings directly into your browser. The website is ready to deploy; this repository does not publish it automatically.

The existing 2D task manager and Three.js motherboard remain. Click CPU, RAM, GPU, or storage to inspect live readings; higher load increases the component’s glow. Missing sensors remain unavailable rather than becoming demo readings.

## How it works

```text
Vercel / pulse.thomasnewman.ca ── HTML, JavaScript, app downloads ──→ Browser
                                                                     ↑
macOS APIs / Linux procfs → C++ telemetryd → 127.0.0.1:8765 ────────────┘
                                            paired HTTP event stream
```

There is no cloud telemetry endpoint, Next.js relay, webhook, account, or database. Charts and history stay in browser memory. The companion opens a loopback listener only; no firewall changes, administrator access, Node.js runtime, or local website server are needed by end users. The Mac companion is a menu bar app that bundles the collector and stops it when you quit. The collector also exits if the companion closes unexpectedly.

The interface loads only bundled assets, with no analytics or external fonts. Vercel receives ordinary website and download requests, not the hardware stream. The hosted JavaScript is trusted to handle your readings, so control of the domain and deployment still matters. This does not isolate readings from other software already running on your computer.

## User flow

1. Visit Pulse and choose **Connect computer**.
2. Download Pulse Companion, unzip it, move it to Applications, and open it.
3. Choose **Find companion**. Allow local-network access if your browser asks.
4. Copy the pairing code from the app’s menu bar icon and enter it on the website.

The browser connects only to `http://127.0.0.1:8765`, with credentials bound to the website origin. Browser support and local-network permission policies vary; use a current desktop Chrome or Edge for the initial release. HTTPS-to-loopback access must be tested on the actual deployed domain before public release. Browser permission denial, an absent app, or an unapproved origin produces setup guidance rather than fake data. Demo mode remains explicit.

Pairing tokens are random, stored in tab-scoped sessionStorage, and expire after 12 hours. The code changes each time the collector starts; restarting invalidates all tokens. **Disconnect** revokes that tab’s token and clears its displayed readings. Requests must use an exact approved origin and loopback Host header. Pairing has bounded payloads and a five-failure-per-minute limit; snapshots and streams require a token. Health exposes only protocol version and readiness. This is a browser pairing boundary, not protection against malicious native software.

## Deploy to Vercel

1. Build the companion for the production domain using the commands below. Keep the generated production ZIP and `public/downloads/manifest.json` in the deployed repository so the download is available.
2. Import this repository in Vercel using the **Next.js** framework preset. `vercel.json` supplies `npm run build` and security headers. Leave the project’s **Output Directory override disabled**: Vercel’s Next.js adapter needs the default `.next` build directory to read its manifests and handles the static export itself. `next.config.ts` still uses `output: "export"`, so `npm run build` generates the static site in `out`; no telemetry functions run on Vercel.
3. Add `pulse.thomasnewman.ca` to the project’s domains and configure the DNS record Vercel provides.
4. Test download → app launch → permission → pairing → live readings from the HTTPS domain.

The default companion URL is in `companion/config.json`. Vercel preview URLs are deliberately unapproved. To test a preview, package a companion with its exact HTTPS origin using `--url`; never use a wildcard origin. Changing the production domain requires a new companion build.

### Build the downloadable app

Requires Node.js 20.9+, npm, CMake 3.16+, and a C++17 compiler. macOS additionally needs Apple’s Command Line Tools and Swift. Windows is not supported yet.

```sh
npm install
npm run companion:package
npm run build
```

Packaging defaults to `https://pulse.thomasnewman.ca` and produces a ZIP on Mac or a tarball on Linux, plus a download manifest with SHA-256 checksum. Each build targets the current machine’s architecture. The initial artifact is **macOS Apple Silicon, macOS 13+**; build on an Intel Mac for Intel support and on Linux for a Linux package. Linux collectors and packaging require verification on Linux.

The initial Mac build is locally/ad-hoc signed, **not Developer ID signed or notarized**. Gatekeeper can block a browser-downloaded copy. Before public distribution, use an Apple Developer ID identity and a saved notarytool keychain profile:

```sh
PULSE_CODESIGN_IDENTITY='Developer ID Application: YOUR IDENTITY' \
PULSE_NOTARY_PROFILE='your-saved-notary-profile' npm run companion:package
npm run build
```

The packager signs the collector and app, submits the archive for notarization, staples the ticket, and only then marks the Mac download as a signed release. The app remains explicitly marked as a development build until this is done. Signing credentials remain on the packaging machine; Vercel needs none. Do not change browser security settings to make the connection work.

## Develop locally

```sh
npm run daemon:build
npm run local
```

Open **http://127.0.0.1:3000**, choose Connect computer, find the companion, and enter the `PAIRING_CODE` printed in the terminal. `Ctrl+C` stops both processes. Running a local web server is only a development convenience.

To test the Mac application against the development website:

```sh
npm run companion:package -- --development --url http://127.0.0.1:3000
```

Development archives are ignored by Git. Packaging a production release removes development entries from the download manifest.

Do not run a standalone daemon and the app together: both use port 8765. Native endpoints are `GET /health`, `POST /pair`, authenticated `GET /snapshot`, authenticated `GET /events`, and authenticated `DELETE /session`. For manual production-origin testing, start `telemetryd --allow-origin https://pulse.thomasnewman.ca`.

## Collector support

| Metric | macOS | Linux |
| --- | --- | --- |
| CPU and per-core load | Mach processor ticks | `/proc/stat` |
| Memory and swap | Mach VM statistics + sysctl | `/proc/meminfo` |
| Processes | libproc, accessible processes only | accessible `/proc/<pid>` entries |
| Disk capacity | APFS data volume or root filesystem | root filesystem |
| Disk read/write | IOKit, if exposed | physical device counters in `/proc/diskstats` |
| Disk activity % | unavailable | physical device busy time, aggregated and capped at 100% |
| Network transfer | interface counters, excluding loopback | `/proc/net/dev`, excluding loopback |
| CPU frequency | sysctl, if exposed (may be nominal) | cpufreq, if exposed |
| CPU temperature | unavailable | matching CPU/SOC thermal zone, if exposed |
| GPU | available IOAccelerator registry properties | DRM sysfs, typically supported AMD drivers |
| GPU temperature | unavailable | DRM hwmon, if exposed |

GPU support varies by driver. Apple Silicon's GPU counters and temperatures are not consistently exposed through public APIs; missing metrics stay null. NVIDIA's proprietary driver may require an NVML collector in a future version. Disk throughput represents all supported physical devices, while capacity represents the system volume. macOS memory usage includes active, wired, and compressed pages and may differ from Activity Monitor. Process CPU is normalized by logical core count, so its scale matches overall CPU usage.

## Verify and build

```sh
npm run typecheck
npm run lint
npm test
npm run test:native  # stop any running companion/daemon first; uses port 8765
npm run build
npm run start        # preview the exported static site on 127.0.0.1:3000
```

`./daemon/build/telemetryd --once` prints a real sample without opening a port. Tests cover schema validation, fragmented streams, session validation, native pairing, approved CORS preflights, rebinding protection, token origin binding, revocation, attempt limits, successive samples, client disconnects, and collector shutdown when its companion exits. macOS is the initial development platform; an actual hosted HTTPS browser connection and signed distribution remain release checks.
