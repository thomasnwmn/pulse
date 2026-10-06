# Pulse · System Telemetry

A local Next.js dashboard and C++ hardware collector. Switch between a lightweight 2D task manager and a procedural Three.js motherboard. Click the CPU, RAM, GPU, or NVMe drive to inspect it; load increases its emissive color from green through amber to red.

## Run locally

Requires Node.js 20.9+ (Node 24 recommended), npm, CMake 3.16+, and a C++17 compiler. On macOS, install Apple's Command Line Tools; Linux needs a compiler toolchain. Windows is not supported yet.

```sh
npm install
npm run daemon:build
npm run local
```

Open **http://127.0.0.1:3000**. Both servers bind to IPv4 loopback. `Ctrl+C` stops them.

You can also start them in separate terminals:

```sh
npm run daemon
npm run dev
```

The dashboard starts in live mode. If the daemon is absent, it shows a connection guide; **Explore demo** explicitly enables simulated readings. Connection settings lets you switch back to your computer.

## Features

- CPU, memory, GPU, disk, and network views with rolling 1, 5, and 15 minute charts. History stays in browser memory and begins when you open the dashboard.
- Per-core CPU readings, process search and sorting, pause/resume, and JSON snapshot export.
- Lazy-loaded 3D model with orbit/zoom controls, hover hints, clickable components, load-based glow, and a reset view button. The model is a schematic, not a hardware scan.
- 3D runs at up to 30 fps, caps pixel density at 1.5, and stops drawing when off screen or the tab is hidden. Switching to 2D disposes the renderer and its resources.
- Unavailable sensors display a dash and use neutral coloring. They are never replaced by demo data automatically.

## Data flow and privacy

```text
macOS APIs / Linux procfs + sysfs
              ↓ 1 second sampling
C++ telemetryd · 127.0.0.1:8765
              ↓ HTTP Server-Sent Events
Next.js /api/telemetry · 127.0.0.1:3000
              ↓ same-origin EventSource
2D dashboard / Three.js motherboard
```

This is a continuous local event stream, rather than a cloud webhook. Native endpoints are `GET /health`, `GET /snapshot`, and `GET /events`. The proxy target is fixed to loopback. Native Host/origin checks and dashboard same-origin checks block requests from arbitrary websites and DNS rebinding hosts; no permissive CORS is enabled. This does not isolate data from other software already running on your computer.

No accounts, remote model assets, analytics, external fonts, or external runtime services. Dependencies are downloaded during installation. Next.js diagnostic telemetry is disabled in the provided npm scripts. No daemon installation, root access, or persistent background service is required. Process names, PIDs, memory, and CPU usage are collected; command lines and environment variables are not.

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
npm run test:native  # stop any running daemon first; uses port 8765
npm run build
npm run start        # production dashboard on loopback
```

`./daemon/build/telemetryd --once` prints a real JSON sample without opening a port. Native integration tests check the schema, request restrictions, successive SSE samples, and client disconnects. macOS is the initial development platform; Linux collectors require verification on a Linux machine.
