export type ComponentId = "cpu" | "memory" | "gpu" | "storage";
export type Section = "overview" | ComponentId | "network";

export interface Telemetry {
  version: 1;
  timestamp: number;
  system: { hostname: string; platform: string; uptime: number };
  cpu: { model: string; cores: number; usage: number; perCore: number[]; temperature: number | null; frequency: number | null };
  memory: { total: number; used: number; available: number; swapUsed: number; swapTotal: number };
  gpu: { model: string; usage: number | null; temperature: number | null; memoryUsed: number | null; memoryTotal: number | null };
  storage: { model: string; total: number; used: number; readBytesPerSec: number | null; writeBytesPerSec: number | null; activity: number | null; temperature: number | null };
  network: { receivedBytesPerSec: number; sentBytesPerSec: number; interface: string };
  processes: { pid: number; name: string; cpu: number; memory: number }[];
}

export const componentNames: Record<ComponentId, string> = { cpu: "Processor", memory: "Memory", gpu: "Graphics", storage: "Storage" };
export const componentColors: Record<ComponentId, string> = { cpu: "#84ad28", memory: "#7c80de", gpu: "#d49c49", storage: "#599fa5" };

export function percent(used: number, total: number) { return total > 0 ? Math.min(100, Math.max(0, used / total * 100)) : 0; }
export function componentLoad(data: Telemetry, id: ComponentId): number | null {
  if (id === "cpu") return data.cpu.usage;
  if (id === "memory") return percent(data.memory.used, data.memory.total);
  if (id === "gpu") return data.gpu.usage;
  return data.storage.activity;
}
export function bytes(value: number, decimals = 1): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : decimals)} ${units[index]}`;
}
export function duration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return `${days ? `${days}d ` : ""}${hours}h ${minutes}m`;
}

// Validate the full wire shape before accepting an event from a native process.
export function isTelemetry(value: unknown): value is Telemetry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
  const number = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;
  const nullable = (x: unknown) => x === null || number(x);
  const load = (x: unknown) => x === null || (number(x) && x <= 100);
  const text = (x: unknown) => typeof x === "string" && x.length <= 1024;
  if (v.version !== 1 || !number(v.timestamp)) return false;
  const { system: s, cpu: c, memory: m, gpu: g, storage: d, network: n, processes: p } = v;
  return object(s) && text(s.hostname) && text(s.platform) && number(s.uptime)
    && object(c) && text(c.model) && number(c.cores) && Number.isInteger(c.cores) && c.cores > 0 && c.cores <= 4096 && number(c.usage) && c.usage <= 100 && Array.isArray(c.perCore) && c.perCore.length === c.cores && c.perCore.every(x => number(x) && x <= 100) && nullable(c.temperature) && nullable(c.frequency)
    && object(m) && number(m.total) && number(m.used) && m.used <= m.total && number(m.available) && m.available <= m.total && number(m.swapUsed) && number(m.swapTotal) && m.swapUsed <= m.swapTotal
    && object(g) && text(g.model) && load(g.usage) && nullable(g.temperature) && nullable(g.memoryUsed) && nullable(g.memoryTotal)
    && object(d) && text(d.model) && number(d.total) && number(d.used) && d.used <= d.total && load(d.activity) && [d.readBytesPerSec, d.writeBytesPerSec, d.temperature].every(nullable)
    && object(n) && number(n.receivedBytesPerSec) && number(n.sentBytesPerSec) && text(n.interface)
    && Array.isArray(p) && p.length <= 1000 && p.every(x => object(x) && number(x.pid) && text(x.name) && number(x.cpu) && number(x.memory));
}
