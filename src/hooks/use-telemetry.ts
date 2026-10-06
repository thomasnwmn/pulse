"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { demoSnapshot } from "@/lib/demo";
import { DAEMON_URL, isSession, SESSION_KEY, TelemetryStream, type CompanionSession } from "@/lib/local-daemon";
import type { Telemetry } from "@/lib/telemetry";

export type Connection = "idle" | "checking" | "pairing" | "connecting" | "live" | "offline" | "demo";
const unreachable = "Cannot reach Pulse Companion. Open the app and allow local-network access if your browser asks. Also check that the app was built for this website.";
const localFetch = (path: string, options: RequestInit = {}) => fetch(`${DAEMON_URL}${path}`, { mode: "cors", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", ...options });

export function useTelemetry(demo: boolean, paused: boolean) {
  const [feed, setFeed] = useState<{ demo: boolean; data: Telemetry; history: Telemetry[] } | null>(null);
  const [connection, setConnection] = useState<Connection>("idle");
  const [error, setError] = useState("");
  const [session, setSession] = useState<CompanionSession | null>(null);
  const pausedRef = useRef(paused);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  const remember = useCallback((value: CompanionSession | null) => {
    setSession(value);
    try { if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value)); else sessionStorage.removeItem(SESSION_KEY); } catch { /* Pairing still works when storage is disabled. */ }
  }, []);
  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (!mounted) return;
      try { const saved: unknown = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null"); if (isSession(saved)) setSession(saved); else sessionStorage.removeItem(SESSION_KEY); } catch { /* Storage is optional. */ }
    });
    return () => { mounted = false; requestRef.current?.abort(); };
  }, []);

  const check = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController(); requestRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 30000);
    setConnection("checking"); setError("");
    try {
      const response = await localFetch("/health", { signal: controller.signal });
      const health = await response.json();
      if (!response.ok || health.version !== 1 || health.ok !== true) throw new Error("Incompatible companion");
      setConnection("pairing");
    } catch { if (requestRef.current === controller) { setConnection("offline"); setError(unreachable); } }
    finally { clearTimeout(timeout); }
  }, []);
  const pair = useCallback(async (code: string) => {
    requestRef.current?.abort();
    const controller = new AbortController(); requestRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 4000);
    setConnection("connecting"); setError("");
    try {
      const response = await localFetch("/pair", { method: "POST", headers: { "Content-Type": "text/plain" }, body: code.trim(), signal: controller.signal });
      if (!response.ok) {
        setConnection("pairing");
        setError(response.status === 429 ? "Too many attempts. Wait a minute, then try again." : "That pairing code did not match. Copy the current code from Pulse Companion.");
        return;
      }
      const result = await response.json();
      const next = { token: result.token, expires: Date.now() + result.expiresIn * 1000 };
      if (!isSession(next)) throw new Error("Invalid pairing response");
      remember(next);
    } catch { if (requestRef.current === controller) { setConnection("offline"); setError(unreachable); } }
    finally { clearTimeout(timeout); }
  }, [remember]);
  const disconnect = useCallback(() => {
    requestRef.current?.abort();
    if (session) void localFetch("/session", { method: "DELETE", headers: { Authorization: `Bearer ${session.token}` }, signal: AbortSignal.timeout(2000) }).catch(() => {});
    remember(null); setConnection("idle"); setError(""); setFeed(null);
  }, [remember, session]);

  useEffect(() => {
    const controller = new AbortController();
    let watchdog: ReturnType<typeof setInterval> | undefined;
    const accept = (snapshot: Telemetry) => {
      setConnection(demo ? "demo" : "live"); setError("");
      if (!pausedRef.current) setFeed(previous => ({ demo, data: snapshot, history: previous?.demo === demo ? [...previous.history.slice(-899), snapshot] : [snapshot] }));
    };
    if (demo) {
      queueMicrotask(() => { if (!controller.signal.aborted) accept(demoSnapshot()); });
      const interval = setInterval(() => accept(demoSnapshot()), 1000);
      return () => { controller.abort(); clearInterval(interval); };
    }
    if (!session) return () => controller.abort();
    const run = async () => {
      let failures = 0;
      while (!controller.signal.aborted) {
        if (session.expires <= Date.now()) { remember(null); setConnection("pairing"); setError("Your session expired. Pair again to continue."); break; }
        const attempt = new AbortController();
        const abort = () => attempt.abort(); controller.signal.addEventListener("abort", abort, { once: true });
        let received = Date.now();
        watchdog = setInterval(() => { if (Date.now() - received > 6000) attempt.abort(); }, 1000);
        setConnection(failures ? "offline" : "connecting");
        try {
          const response = await localFetch("/events", { headers: { Authorization: `Bearer ${session.token}` }, signal: attempt.signal });
          if (response.status === 401) { remember(null); setConnection("pairing"); setError("Pulse Companion restarted or your session expired. Pair again to continue."); break; }
          if (!response.ok || !response.body) throw new Error("Companion unavailable");
          const reader = response.body.getReader(); const decoder = new TextDecoder(); const stream = new TelemetryStream();
          try {
            while (!controller.signal.aborted) {
              const { value, done } = await reader.read();
              if (done) throw new Error("Companion disconnected");
              for (const snapshot of stream.push(decoder.decode(value, { stream: true }))) { received = Date.now(); failures = 0; accept(snapshot); }
            }
          } finally { await reader.cancel().catch(() => {}); }
        } catch {
          if (controller.signal.aborted) break;
          setConnection("offline"); setError(unreachable); failures++;
        } finally { clearInterval(watchdog); attempt.abort(); controller.signal.removeEventListener("abort", abort); }
        await new Promise<void>(resolve => { const finish = () => { clearTimeout(timer); controller.signal.removeEventListener("abort", finish); resolve(); }; const timer = setTimeout(finish, Math.min(15000, 1000 * 2 ** Math.min(failures, 4))); controller.signal.addEventListener("abort", finish, { once: true }); if (controller.signal.aborted) finish(); });
      }
    };
    void run();
    return () => { controller.abort(); clearInterval(watchdog); };
  }, [demo, session, remember]);
  return { data: feed?.demo === demo ? feed.data : null, history: feed?.demo === demo ? feed.history : [], connection: demo ? "demo" as const : connection === "demo" ? "idle" as const : connection, error, check, pair, disconnect, hasSession: !!session };
}
