"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpRight, Check, Monitor, ShieldCheck, X } from "lucide-react";
import type { Connection } from "@/hooks/use-telemetry";

type Release = { label: string; url: string; origin: string; signed: boolean; development: boolean };
type Props = {
  connection: Connection; error: string; demo: boolean; hasSession: boolean;
  onCheck: () => Promise<void>; onPair: (code: string) => Promise<void>;
  onDisconnect: () => void; onDemo: () => void; onClose: () => void;
};

export default function CompanionSetup({ connection, error, demo, hasSession, onCheck, onPair, onDisconnect, onDemo, onClose }: Props) {
  const [code, setCode] = useState("");
  const [releases, setReleases] = useState<Release[]>([]);
  const [downloadsLoaded, setDownloadsLoaded] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
      if (event.key === "Tab") {
        const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled)") ?? []);
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", keydown);
    const controller = new AbortController();
    void fetch("/downloads/manifest.json", { cache: "no-store", signal: controller.signal }).then(response => response.json()).then(manifest => {
      if (manifest.version !== 1 || !Array.isArray(manifest.releases)) return;
      setReleases(manifest.releases.filter((release: Release) => release && typeof release.label === "string" && typeof release.url === "string" && /^\/downloads\/[a-zA-Z0-9._-]+\.(zip|tar\.gz)$/.test(release.url) && release.origin === window.location.origin));
    }).catch(() => {}).finally(() => { if (!controller.signal.aborted) setDownloadsLoaded(true); });
    return () => { controller.abort(); document.removeEventListener("keydown", keydown); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  const busy = connection === "checking" || connection === "connecting";
  const live = connection === "live" && !demo;
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="modal panel companion-modal" role="dialog" aria-modal="true" aria-labelledby="companion-title">
      <button className="icon-button modal-close" aria-label="Close dialog" onClick={onClose}><X size={19} /></button>
      <div className="modal-icon"><Monitor size={25} /></div>
      <h2 id="companion-title">Your computer, connected.</h2>
      <p>Install Pulse Companion, then pair this browser. Your hardware readings travel directly from the app to this page.</p>
      {live ? <div className="companion-connected"><Check size={22} /><div><strong>Connected to your computer</strong><span>Live readings · updated every second</span></div></div> : <>
        <div className="setup-step"><span>01</span><div><strong>Download &amp; open Pulse Companion</strong><span className="setup-description">On Mac, unzip the download and move the app to Applications.</span>
          <div className="companion-downloads">{releases.map(release => <a key={release.url} className="button" href={release.url} download><ArrowDownToLine size={14} />{release.label}</a>)}</div>
          {!releases.length && <span className="setup-description">{downloadsLoaded ? "A companion download for this website has not been published yet." : "Checking available downloads…"}</span>}
          {releases.some(release => !release.signed) && <span className="setup-description">Development build · unsigned. A signed release is needed for public Mac distribution.</span>}
        </div></div>
        <div className="setup-step"><span>02</span><div><strong>Find your companion</strong><span className="setup-description">Keep the app open. Allow local-network access if your browser asks.</span><button className="button" onClick={onCheck} disabled={busy || demo}>{connection === "checking" ? "Looking for your app…" : connection === "pairing" ? <><Check size={14} /> Companion found</> : "Find companion"}<ArrowUpRight size={14} /></button></div></div>
        {(connection === "pairing" || connection === "connecting") && !demo && <form className="setup-step" onSubmit={event => { event.preventDefault(); void onPair(code); }}><span>03</span><div><label htmlFor="pairing-code"><strong>Enter your pairing code</strong></label><span className="setup-description">Choose “Copy pairing code” from the app’s menu bar icon.</span><div className="pairing-form"><input id="pairing-code" autoComplete="off" spellCheck={false} value={code} onChange={event => setCode(event.target.value.replace(/[\s-]/g, "").slice(0, 12))} placeholder="12-character code" maxLength={12} disabled={busy} /><button className="button primary-button" type="submit" disabled={busy || !/^[a-fA-F0-9]{12}$/.test(code)}>{busy ? "Pairing…" : "Pair browser"}</button></div></div></form>}
      </>}
      {error && !demo && <p className="connection-error" role="alert">{error}</p>}
      <div className="modal-note"><ShieldCheck size={17} /><span>Telemetry stays on your device. Pairing lasts for this browser tab, up to 12 hours, and ends when the companion restarts.</span></div>
      <div className="companion-footer"><button className="text-button" onClick={onDemo}>{demo ? "Use my computer" : "Explore demo"}</button>{hasSession && <button className="text-button" onClick={onDisconnect}>Disconnect</button>}{live && <button className="button primary-button" onClick={onClose}>Done <Check size={14} /></button>}</div>
    </section>
  </div>;
}
