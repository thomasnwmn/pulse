"use client";

import { useEffect, useRef, useState } from "react";
import { demoSnapshot } from "@/lib/demo";
import { isTelemetry, type Telemetry } from "@/lib/telemetry";

export type Connection = "connecting" | "live" | "offline" | "demo";
export function useTelemetry(demo: boolean, paused: boolean) {
  const [feed, setFeed] = useState<{ demo: boolean; data: Telemetry; history: Telemetry[] } | null>(null);
  const [status, setStatus] = useState<{ demo: boolean; connection: Connection }>({ demo: false, connection: "connecting" });
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => {
    let source: EventSource | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;
    let received = Date.now();
    const setConnection = (connection: Connection) => setStatus({ demo, connection });
    const accept = (snapshot: Telemetry) => {
      received = Date.now();
      setConnection(demo ? "demo" : "live");
      if (!pausedRef.current) setFeed(previous => ({ demo, data: snapshot, history: previous?.demo === demo ? [...previous.history.slice(-899), snapshot] : [snapshot] }));
    };
    if (demo) {
      accept(demoSnapshot());
      interval = setInterval(() => accept(demoSnapshot()), 1000);
    } else {
      source = new EventSource("/api/telemetry");
      source.onmessage = event => {
        try { const snapshot: unknown = JSON.parse(event.data); if (isTelemetry(snapshot)) accept(snapshot); else setConnection("offline"); }
        catch { setConnection("offline"); }
      };
      source.onerror = () => setConnection("offline");
      interval = setInterval(() => { if (Date.now() - received > 5000) setConnection("offline"); }, 1000);
    }
    return () => { source?.close(); clearInterval(interval); };
  }, [demo]);
  return { data: feed?.demo === demo ? feed.data : null, history: feed?.demo === demo ? feed.history : [], connection: status.demo === demo ? status.connection : "connecting" as Connection };
}
