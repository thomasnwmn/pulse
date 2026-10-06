"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { Activity, ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpRight, Box, ChevronDown, CircleHelp, Cpu, HardDrive, LayoutDashboard, MemoryStick, Monitor, Network, Pause, Play, Search, Settings2, ShieldCheck, Terminal } from "lucide-react";
import { useTelemetry } from "@/hooks/use-telemetry";
import { bytes, componentColors, componentLoad, componentNames, duration, percent, type ComponentId, type Section, type Telemetry } from "@/lib/telemetry";
import Chart, { Sparkline } from "./chart";
import CompanionSetup from "./companion-setup";

const Motherboard = dynamic(() => import("./motherboard"), { ssr: false, loading: () => <div className="scene-loading"><Box size={32} /><span>Building your motherboard…</span></div> });
const icons = { cpu: Cpu, memory: MemoryStick, gpu: Monitor, storage: HardDrive };
const navItems: { id: Section; label: string; icon: typeof Cpu }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "cpu", label: "Processor", icon: Cpu },
  { id: "memory", label: "Memory", icon: MemoryStick },
  { id: "gpu", label: "Graphics", icon: Monitor },
  { id: "storage", label: "Storage", icon: HardDrive },
  { id: "network", label: "Network", icon: Network },
];
const ids: ComponentId[] = ["cpu", "memory", "gpu", "storage"];

function metricText(value: number | null | undefined, unit = "%") { return value == null ? "—" : `${value.toFixed(unit === "GHz" ? 2 : 0)}${unit === "GHz" ? " " : ""}${unit}`; }

export default function Dashboard() {
  const [section, setSection] = useState<Section>("overview");
  const [view3d, setView3d] = useState(false);
  const [selected, setSelected] = useState<ComponentId>("cpu");
  const [demo, setDemo] = useState(false);
  const [paused, setPaused] = useState(false);
  const [seconds, setSeconds] = useState(60);
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(false);
  const { data, history, connection, error, check, pair, disconnect, hasSession } = useTelemetry(demo, paused);
  const live = connection === "live";
  const available = live || demo;
  const navigate = (id: Section) => { setSection(id); if (ids.includes(id as ComponentId)) setSelected(id as ComponentId); };
  const exportSnapshot = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify({ source: demo ? "demo" : "native-daemon", ...data }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `pulse-${data.timestamp}.json`; anchor.click(); URL.revokeObjectURL(url);
  };
  return <div className="app-shell">
    <header className="topbar">
      <Link className="brand" href="/" aria-label="Pulse home"><span className="brand-mark"><Activity size={22} strokeWidth={2.4} /></span><span>pulse<span className="brand-dot">.</span></span></Link>
      <div className="topbar-actions"><div className="view-control"><span className={!view3d ? "active-view-label" : ""}>2D view</span><button role="switch" aria-checked={view3d} aria-label="3D motherboard view" onClick={() => setView3d(!view3d)} className={`view-switch ${view3d ? "on" : ""}`}><span /></button><span className={view3d ? "active-view-label" : ""}>3D view</span></div><span className="topbar-divider" /><button className="icon-button" aria-label="Connection settings" onClick={() => setSettings(true)}><Settings2 size={19} /></button></div>
    </header>
    <aside className="sidebar">
      <div className="device-card"><div className="device-icon"><Monitor size={21} /></div><div><strong>{data?.system.hostname ?? "This computer"}</strong><span>{demo ? "Demo workstation" : data?.system.platform ?? "Local workstation"}</span></div><span className={`status-dot ${live ? "green" : demo ? "amber" : "gray"}`} /></div>
      <nav aria-label="Telemetry sections">{navItems.map(item => <button key={item.id} className={`nav-item ${section === item.id ? "selected" : ""}`} onClick={() => navigate(item.id)}><item.icon size={18} /><span>{item.label}</span>{item.id === "overview"}{ids.includes(item.id as ComponentId) && data && <span className="nav-stat">{metricText(componentLoad(data, item.id as ComponentId))}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><button className="sidebar-help" onClick={() => setHelp(true)}><CircleHelp size={17} /><span>Getting started</span><ArrowUpRight size={14} /></button><div className="sidebar-footer"><ShieldCheck size={12} /> Your data stays on your device.</div></div>
    </aside>
    <main className="main-content">
      <nav className="mobile-nav" aria-label="Mobile telemetry sections">{navItems.map(item => <button key={item.id} className={section === item.id ? "selected" : ""} onClick={() => navigate(item.id)}><item.icon size={14} />{item.label}</button>)}</nav>
      <div className="page-breadcrumb">Workspace <span>/</span> <strong>{navItems.find(item => item.id === section)?.label}</strong>{view3d && <><span>/</span><strong>3D view</strong></>}</div>
      <div className="page-heading"><h1>{section === "overview" ? "System Overview" : `${navItems.find(item => item.id === section)?.label} Overview`}</h1><div className="heading-actions"><button className={`button ${paused ? "paused-button" : ""}`} onClick={() => setPaused(!paused)} disabled={!available} aria-label={paused ? "Resume telemetry" : "Pause telemetry"}>{paused ? <Play size={15} /> : <Pause size={15} />}<span>{paused ? "Resume" : "Pause"}</span></button><button className="button" onClick={exportSnapshot} disabled={!data} aria-label="Export snapshot"><ArrowDownToLine size={15} /><span>Export snapshot</span></button></div></div>
      {!available && <div className="offline-banner"><Monitor size={20} /><div><strong>{connection === "connecting" ? "Connecting to your computer…" : hasSession ? "Your companion is disconnected." : "Bring your computer into view."}</strong><span>{hasSession ? "Open Pulse Companion to resume live readings." : "Download Pulse Companion and pair this browser to see your system live."}</span></div><button className="button" onClick={() => setSettings(true)}>Connect computer <ArrowUpRight size={14} /></button><button className="text-button" onClick={() => { setDemo(true); setPaused(false); }}>Explore demo</button></div>}
      {demo && <div className="demo-notice"><span>Previewing a simulated workstation. All readings below are demo data.</span><button onClick={() => { setDemo(false); setPaused(false); setSettings(true); }}>Connect my computer <ArrowUpRight size={13} /></button></div>}
      <div className="metric-grid">{ids.map(id => <MetricCard key={id} id={id} data={data} history={history} active={view3d ? selected === id : section === id} onClick={() => view3d ? setSelected(id) : navigate(id)} />)}</div>
      {view3d ? <div className="motherboard-layout"><section className="panel motherboard-panel"><div className="panel-heading"><div><div className="panel-title"><Box size={17} /><h2>Hardware explorer</h2></div></div></div><Motherboard data={data} selected={selected} onSelect={setSelected} /><div className="scene-footer"><span><span className="heat-gradient" /> Cool <span className="heat-dash">→</span> High load</span><span>Drag to rotate · Scroll to zoom</span></div></section><ComponentDetails id={selected} data={data} /></div>
        : <><section className="panel performance-panel"><div className="panel-heading"><div><div className="panel-title"><Activity size={17} /><h2>{section === "overview" ? "System activity" : `${navItems.find(item => item.id === section)?.label} activity`}</h2><span className="small-tag">REAL TIME</span></div></div><div className="range-control" aria-label="Chart time range">{[60, 300, 900].map(value => <button key={value} onClick={() => setSeconds(value)} className={seconds === value ? "selected" : ""}>{value / 60}m</button>)}</div></div><Chart history={history} seconds={seconds} metric={section} /><div className="chart-legend">{section === "overview" ? <><span><i style={{ background: componentColors.cpu }} />CPU usage <strong>{metricText(data?.cpu.usage)}</strong></span><span><i style={{ background: componentColors.memory }} />Memory <strong>{data ? metricText(percent(data.memory.used, data.memory.total)) : "—"}</strong></span></> : section === "network" ? <><span><i style={{ background: componentColors.cpu }} />Download <strong>{data ? `${bytes(data.network.receivedBytesPerSec)}/s` : "—"}</strong></span><span><i style={{ background: componentColors.memory }} />Upload <strong>{data ? `${bytes(data.network.sentBytesPerSec)}/s` : "—"}</strong></span></> : <span><i style={{ background: componentColors[section] }} />{section === "storage" ? "Disk activity" : `${componentNames[section]} usage`}<strong>{data ? metricText(componentLoad(data, section)) : "—"}</strong></span>}<span className="legend-caption">{history.length} samples collected</span></div></section>
          {section !== "overview" && section !== "network" && <DetailBreakdown id={section} data={data} />}
          <div className="bottom-grid"><ProcessTable data={data} /><SystemInfo data={data} demo={demo} /></div></>}
    </main>
    {(settings || help) && <CompanionSetup connection={connection} error={error} demo={demo} hasSession={hasSession} onCheck={check} onPair={pair} onDisconnect={disconnect} onDemo={() => { setDemo(!demo); setPaused(false); }} onClose={() => { setSettings(false); setHelp(false); }} />}
  </div>;
}

function MetricCard({ id, data, history, active, onClick }: { id: ComponentId; data: Telemetry | null; history: Telemetry[]; active: boolean; onClick: () => void }) {
  const Icon = icons[id];
  const load = data ? componentLoad(data, id) : null;
  const temperature = data && id !== "memory" ? data[id].temperature : null;
  const sub = !data ? "Waiting for connection" : id === "cpu" ? `${data.cpu.cores} logical cores` : id === "memory" ? `${bytes(data.memory.used)} of ${bytes(data.memory.total)}` : id === "gpu" ? data.gpu.memoryUsed == null ? "Sensor unavailable" : `${bytes(data.gpu.memoryUsed)} VRAM used` : `${bytes(data.storage.used)} of ${bytes(data.storage.total)}`;
  return <button className={`metric-card ${active ? "active" : ""}`} onClick={onClick} style={{ "--metric-color": componentColors[id] } as React.CSSProperties}><div className="metric-card-top"><span className="metric-icon"><Icon size={17} /></span><span>{componentNames[id]}</span><ArrowUpRight size={14} /></div><div className="metric-card-value"><strong>{load === null ? "—" : load.toFixed(0)}<small>{load === null ? "" : "%"}</small></strong><Sparkline values={history.map(d => componentLoad(d, id))} color={componentColors[id]} /></div><div className="metric-card-bottom"><span>{sub}</span>{temperature !== null && <span className="temperature">{temperature.toFixed(0)}°C</span>}</div><div className="metric-card-track"><span style={{ width: `${load ?? 0}%`, background: componentColors[id] }} /></div></button>;
}

function ComponentDetails({ id, data }: { id: ComponentId; data: Telemetry | null }) {
  const Icon = icons[id];
  const load = data ? componentLoad(data, id) : null;
  const model = !data ? "Waiting for hardware" : id === "memory" ? `${bytes(data.memory.total)} system memory` : data[id].model;
  const pairs: [string, string][] = !data ? [] : id === "cpu" ? [["Clock speed", metricText(data.cpu.frequency, "GHz")], ["Logical cores", String(data.cpu.cores)], ["Temperature", metricText(data.cpu.temperature, "°C")]] : id === "memory" ? [["In use", bytes(data.memory.used)], ["Available", bytes(data.memory.available)], ["Swap used", bytes(data.memory.swapUsed)]] : id === "gpu" ? [["Temperature", metricText(data.gpu.temperature, "°C")], ["Memory used", data.gpu.memoryUsed === null ? "—" : bytes(data.gpu.memoryUsed)], ["Memory total", data.gpu.memoryTotal === null ? "—" : bytes(data.gpu.memoryTotal)]] : [["Read speed", data.storage.readBytesPerSec === null ? "—" : `${bytes(data.storage.readBytesPerSec)}/s`], ["Write speed", data.storage.writeBytesPerSec === null ? "—" : `${bytes(data.storage.writeBytesPerSec)}/s`], ["Space used", `${bytes(data.storage.used)} / ${bytes(data.storage.total)}`]];
  return <aside className="panel component-panel"><span className="eyebrow">COMPONENT INSPECTOR</span><div className="component-big-icon" style={{ color: componentColors[id] }}><Icon size={32} strokeWidth={1.4} /></div><h2>{componentNames[id]}</h2><p className="component-model">{model}</p><div className="component-load"><span>{id === "storage" ? "Disk activity" : id === "memory" ? "Memory in use" : "Current load"}</span><strong>{metricText(load)}</strong><div className="progress-track"><span style={{ width: `${load ?? 0}%`, background: componentColors[id] }} /></div></div><dl className="detail-list">{pairs.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl></aside>;
}

function DetailBreakdown({ id, data }: { id: ComponentId; data: Telemetry | null }) {
  if (id === "cpu") return <section className="panel breakdown"><div className="panel-title"><Cpu size={17} /><h2>Logical cores</h2><span className="small-tag">{data?.cpu.cores ?? "—"} CORES</span></div><div className="core-grid">{(data?.cpu.perCore ?? []).map((usage, i) => <div key={i}><span>Core {i + 1}</span><strong>{usage.toFixed(0)}%</strong><div className="progress-track"><span style={{ width: `${usage}%` }} /></div></div>)}{!data && <p>Connect your daemon to see per-core activity.</p>}</div></section>;
  return <ComponentDetails id={id} data={data} />;
}

function ProcessTable({ data }: { data: Telemetry | null }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"cpu" | "memory" | "name">("cpu");
  const [descending, setDescending] = useState(true);
  const processes = [...(data?.processes ?? [])].filter(p => p.name.toLowerCase().includes(query.toLowerCase()) || String(p.pid).includes(query)).sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : a[sort] - b[sort]) * (descending ? -1 : 1));
  const changeSort = (key: typeof sort) => { if (key === sort) setDescending(!descending); else { setSort(key); setDescending(key !== "name"); } };
  return <section className="panel process-panel"><div className="panel-heading"><div className="panel-title"><Terminal size={17} /><h2>Active processes</h2><span className="process-count">{data?.processes.length ?? 0}</span></div><label className="process-search"><Search size={14} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a process…" aria-label="Search processes" /></label></div><div className="process-table-scroll"><table><thead><tr><th><button onClick={() => changeSort("name")}>Process {sort === "name" && <ChevronDown size={12} className={!descending ? "flipped" : ""} />}</button></th><th>PID</th><th><button onClick={() => changeSort("cpu")}>CPU {sort === "cpu" && <ChevronDown size={12} className={!descending ? "flipped" : ""} />}</button></th><th><button onClick={() => changeSort("memory")}>Memory {sort === "memory" && <ChevronDown size={12} className={!descending ? "flipped" : ""} />}</button></th></tr></thead><tbody>{processes.map((p, i) => <tr key={p.pid}><td><span className={`process-icon color-${i % 5}`}>{p.name.slice(0, 1).toUpperCase()}</span><span title={p.name}>{p.name}</span></td><td>{p.pid}</td><td><span className="process-cpu-bar" style={{ width: `${Math.min(p.cpu, 100)}%` }} /><span>{p.cpu.toFixed(1)}%</span></td><td>{bytes(p.memory)}</td></tr>)}</tbody></table>{processes.length === 0 && <div className="table-empty">{query ? "No processes match your search." : data ? "Process information is unavailable." : "Processes will appear when your daemon connects."}</div>}</div><div className="table-footer"><span>Top {data?.processes.length ?? 0} processes · CPU normalized across all cores</span><span className="table-refresh"><span className="status-dot green" /> 1s refresh</span></div></section>;
}

function SystemInfo({ data, demo }: { data: Telemetry | null; demo: boolean }) {
  return <section className="panel system-panel"><div className="panel-title"><Cpu size={17} /><h2>Your machine</h2></div><div className="system-device"><div className="system-device-drawing"><Monitor size={57} strokeWidth={.9} /><span className="device-spark"></span></div><strong>{data?.system.hostname ?? "This computer"}</strong><span>{data?.system.platform ?? "Local workstation"}</span></div><dl className="system-specs"><div><dt>Processor</dt><dd title={data?.cpu.model}>{data?.cpu.model ?? "—"}</dd></div><div><dt>Memory</dt><dd>{data ? bytes(data.memory.total) : "—"}</dd></div><div><dt>Uptime</dt><dd>{data ? duration(data.system.uptime) : "—"}</dd></div><div><dt>Connection</dt><dd><span className="status-dot green" /> {demo ? "Demo" : "Loopback"}</dd></div></dl><div className="system-bottom"></div><div className="system-network"><span><ArrowDown size={13} />{data ? `${bytes(data.network.receivedBytesPerSec)}/s` : "—"}</span><span><ArrowUp size={13} />{data ? `${bytes(data.network.sentBytesPerSec)}/s` : "—"}</span></div></section>;
}
