import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { isTelemetry } from "../src/lib/telemetry";

let daemon: ChildProcess;
const base = "http://127.0.0.1:8765";
before(async () => {
  daemon = spawn("./daemon/build/telemetryd", [], { stdio: ["ignore", "pipe", "pipe"] });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Daemon did not start")), 5000);
    daemon.stdout!.on("data", chunk => { if (String(chunk).includes("listening")) { clearTimeout(timeout); resolve(); } });
    daemon.stderr!.on("data", chunk => { clearTimeout(timeout); reject(new Error(String(chunk))); });
    daemon.on("error", reject);
  });
});
after(async () => { if (daemon && daemon.exitCode === null) { daemon.kill("SIGTERM"); await once(daemon, "exit"); } });

test("collects a valid snapshot of this computer", async () => {
  const response = await fetch(`${base}/snapshot`);
  assert.equal(response.status, 200);
  const data: unknown = await response.json();
  assert.ok(isTelemetry(data));
  assert.ok(data.cpu.cores > 0);
  assert.ok(data.memory.total > 0);
  assert.equal(data.cpu.perCore.length, data.cpu.cores);
  assert.ok(data.memory.used <= data.memory.total);
});
test("denies remote hosts and browser origins", async () => {
  // Node fetch derives Host from the URL; use a raw HTTP request to exercise rebinding.
  const hostileHostStatus = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(`${base}/snapshot`, { headers: { host: "rebind.example:8765" } }, response => { response.resume(); resolve(response.statusCode!); });
    request.on("error", reject); request.end();
  });
  assert.equal(hostileHostStatus, 403);
  assert.equal((await fetch(`${base}/snapshot`, { headers: { origin: "https://evil.example" } })).status, 403);
  assert.equal((await fetch(`${base}/snapshot`, { headers: { "sec-fetch-site": "cross-site" } })).status, 403);
  assert.equal((await fetch(`${base}/snapshot`, { method: "POST" })).status, 405);
  assert.equal((await fetch(`${base}/missing`)).status, 404);
});
test("streams successive samples and survives a client disconnect", async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${base}/events`, { signal: controller.signal });
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder(); let buffer = ""; const timestamps: number[] = [];
    while (timestamps.length < 2) {
      const { value, done } = await reader.read(); assert.equal(done, false);
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n"); buffer = events.pop()!;
      for (const event of events) { if (!event.startsWith("data: ")) continue; const data: unknown = JSON.parse(event.slice(6)); assert.ok(isTelemetry(data)); timestamps.push(data.timestamp); }
    }
    assert.ok(timestamps[1] > timestamps[0]);
    await reader.cancel();
    assert.equal((await fetch(`${base}/health`)).status, 200);
  } finally { clearTimeout(timeout); controller.abort(); }
});
