import type { Telemetry } from "@/lib/telemetry";
import { percent } from "@/lib/telemetry";

export default function Chart({ history, seconds, metric = "overview" }: { history: Telemetry[]; seconds: number; metric?: "overview" | "cpu" | "memory" | "gpu" | "storage" | "network" }) {
  const end = history.at(-1)?.timestamp ?? 0;
  const start = end - seconds * 1000;
  const samples = history.filter(d => d.timestamp >= start);
  const w = 900, h = 190;
  const networkMax = Math.max(1024 ** 2, ...samples.map(d => Math.max(d.network.receivedBytesPerSec, d.network.sentBytesPerSec)));
  const values = (d: Telemetry, index: number) => {
    if (metric === "network") return (index === 0 ? d.network.receivedBytesPerSec : d.network.sentBytesPerSec) / networkMax * 100;
    if (metric === "memory") return percent(d.memory.used, d.memory.total);
    if (metric === "gpu") return d.gpu.usage;
    if (metric === "storage") return d.storage.activity;
    return index === 0 ? d.cpu.usage : percent(d.memory.used, d.memory.total);
  };
  const series = metric === "overview" || metric === "network" ? 2 : 1;
  const hasReadings = samples.some(d => values(d, 0) !== null);
  const colors = metric === "gpu" ? ["#d49c49"] : metric === "memory" ? ["#8a85cf"] : metric === "storage" ? ["#599fa5"] : ["#86ae36", "#8a85cf"];
  return <div className="chart-wrap">
    <div className="chart-y"><span>{metric === "network" ? "Peak" : "100%"}</span><span>{metric === "network" ? "50%" : "50%"}</span><span>0</span></div>
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="chart-svg" role="img" aria-label={`${metric} telemetry over the last ${seconds} seconds`}>
      <defs>{colors.map((color, i) => <linearGradient key={color} id={`fill-${metric}-${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".16" /><stop offset="100%" stopColor={color} stopOpacity="0.01" /></linearGradient>)}</defs>
      {[0, .25, .5, .75, 1].map(v => <line key={v} x1="0" x2={w} y1={v * (h - 8) + 4} y2={v * (h - 8) + 4} stroke="#e8e9e3" strokeDasharray="3 5" />)}
      {Array.from({ length: series }, (_, index) => {
        const points = samples.flatMap(d => { const value = values(d, index); return value === null ? [] : [{ x: (d.timestamp - start) / (seconds * 1000) * w, y: 4 + (1 - Math.min(100, value) / 100) * (h - 8), value, time: d.timestamp }]; });
        if (!points.length) return null;
        const path = points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
        const last = points.at(-1)!;
        return <g key={index}><path d={`${path} L${last.x},${h} L${points[0].x},${h} Z`} fill={`url(#fill-${metric}-${index})`} /><path d={path} fill="none" stroke={colors[index]} strokeWidth="2.2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" /><circle cx={last.x - 2} cy={last.y} r="3" fill={colors[index]} />{points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="5" fill="transparent"><title>{new Date(p.time).toLocaleTimeString()} · {p.value.toFixed(1)}{metric === "network" ? "% of peak" : "%"}</title></circle>)}</g>;
      })}
    </svg>
    {!hasReadings && <div className="chart-empty">{samples.length ? "Sensor unavailable on this system" : "Waiting for telemetry"}</div>}
    <div className="chart-x"><span>{seconds < 60 ? `${seconds}s` : `${seconds / 60}m`} ago</span><span>{seconds / 2 < 60 ? `${seconds / 2}s` : `${seconds / 120}m`} ago</span><span>Now</span></div>
  </div>;
}

export function Sparkline({ values, color }: { values: (number | null)[]; color: string }) {
  const samples = values.slice(-35).filter((v): v is number => v !== null);
  const points = samples.map((v, i) => `${120 - (samples.length - 1 - i) / 34 * 120},${40 - v / 100 * 34}`).join(" ");
  return <svg viewBox="0 0 120 44" className="sparkline" aria-hidden="true"><polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
