import { isTelemetry, type Telemetry } from "./telemetry";

// This fixed address keeps telemetry off the web host.
export const DAEMON_URL = "http://127.0.0.1:8765";
export const SESSION_KEY = "pulse-companion-session-v1";
export type CompanionSession = { token: string; expires: number };
export function isSession(value: unknown): value is CompanionSession {
  if (!value || typeof value !== "object") return false;
  const session = value as CompanionSession;
  return typeof session.token === "string" && /^[a-f0-9]{64}$/.test(session.token) && Number.isFinite(session.expires) && session.expires > Date.now();
}

// fetch streams allow an Authorization header, unlike EventSource.
export class TelemetryStream {
  private buffer = "";
  push(chunk: string): Telemetry[] {
    this.buffer += chunk;
    if (this.buffer.length > 1024 * 1024) throw new Error("Invalid companion stream");
    const snapshots: Telemetry[] = [];
    let end: number;
    while ((end = this.buffer.indexOf("\n\n")) !== -1) {
      const event = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const data = event.split("\n").filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n");
      if (!data) continue;
      const snapshot: unknown = JSON.parse(data);
      if (!isTelemetry(snapshot)) throw new Error("Invalid companion readings");
      snapshots.push(snapshot);
    }
    return snapshots;
  }
}
