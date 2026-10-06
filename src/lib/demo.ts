import type { Telemetry } from "./telemetry";

export function demoSnapshot(t = Date.now()): Telemetry {
  const wave = (base: number, amplitude: number, period: number, phase = 0) => base + Math.sin(t / period + phase) * amplitude + Math.sin(t / 1730 + phase) * amplitude * .2;
  const cpu = wave(28, 13, 6400);
  const gpu = wave(42, 17, 9400, 2);
  const memoryUsed = wave(13.4, .7, 19000) * 1024 ** 3;
  return {
    version: 1, timestamp: t,
    system: { hostname: "workstation", platform: "Demo system", uptime: 187380 + t % 86400000 / 1000 },
    cpu: { model: "AMD Ryzen 9 7950X", cores: 16, usage: cpu, perCore: Array.from({ length: 16 }, (_, i) => Math.max(0, Math.min(100, cpu + Math.sin(t / 2700 + i * 2) * 19))), temperature: wave(52, 7, 8300), frequency: wave(4.8, .25, 10000) },
    memory: { total: 32 * 1024 ** 3, used: memoryUsed, available: 32 * 1024 ** 3 - memoryUsed, swapUsed: .3 * 1024 ** 3, swapTotal: 8 * 1024 ** 3 },
    gpu: { model: "NVIDIA GeForce RTX 4080", usage: gpu, temperature: wave(58, 5, 7800), memoryUsed: wave(4.2, .3, 17000) * 1024 ** 3, memoryTotal: 16 * 1024 ** 3 },
    storage: { model: "Samsung 990 PRO · NVMe", total: 2 * 1024 ** 4, used: .84 * 1024 ** 4, readBytesPerSec: wave(76, 45, 2800) * 1024 ** 2, writeBytesPerSec: wave(24, 19, 3400) * 1024 ** 2, activity: wave(18, 12, 7300), temperature: wave(39, 3, 9300) },
    network: { receivedBytesPerSec: wave(3.8, 2.9, 7300) * 1024 ** 2, sentBytesPerSec: wave(.82, .45, 4600) * 1024 ** 2, interface: "Ethernet" },
    processes: [
      { pid: 4821, name: "Blender", cpu: wave(9.3, 4, 6100), memory: 2.8 * 1024 ** 3 },
      { pid: 2218, name: "Google Chrome", cpu: wave(5.7, 2, 8700), memory: 1.4 * 1024 ** 3 },
      { pid: 3672, name: "Visual Studio Code", cpu: wave(3.2, 1.5, 6200), memory: 840 * 1024 ** 2 },
      { pid: 1024, name: "WindowServer", cpu: wave(2.4, 1, 4200), memory: 312 * 1024 ** 2 },
      { pid: 5310, name: "telemetryd", cpu: .2, memory: 8.4 * 1024 ** 2 },
      { pid: 3921, name: "Spotify", cpu: wave(.8, .3, 3700), memory: 260 * 1024 ** 2 },
      { pid: 4470, name: "Terminal", cpu: .4, memory: 62 * 1024 ** 2 },
    ],
  };
}
