import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { isTelemetry } from "../src/lib/telemetry";
import { TelemetryStream } from "../src/lib/local-daemon";

let daemon: ChildProcess, code = "", token = "";
const base = "http://127.0.0.1:8765", origin = "https://pulse.thomasnewman.ca", other = "http://127.0.0.1:3000";
const headers = () => ({ Origin: origin, Authorization: `Bearer ${token}` });
const pair = (value: string, site = origin) => fetch(`${base}/pair`, { method: "POST", headers: { Origin: site, "Content-Type": "text/plain" }, body: value });
before(async () => {
  daemon = spawn("./daemon/build/telemetryd", ["--allow-origin", origin, "--allow-origin", other], { stdio: ["ignore", "pipe", "pipe"] });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Daemon did not start")), 5000);
    let output = "";
    daemon.stdout!.on("data", chunk => { output += String(chunk); const match = output.match(/PAIRING_CODE: ([a-f0-9]{12})/); if (match) { code = match[1]; clearTimeout(timeout); resolve(); } });
    daemon.stderr!.on("data", chunk => { clearTimeout(timeout); reject(new Error(String(chunk))); });
    daemon.on("error", reject);
  });
  const response = await pair(code.toUpperCase()); assert.equal(response.status, 200);
  token = (await response.json()).token;
  assert.match(token, /^[a-f0-9]{64}$/);
});
after(async () => { if (daemon && daemon.exitCode === null) { daemon.kill("SIGTERM"); await once(daemon, "exit"); } });

test("health exposes no hardware or pairing secrets; all readings require pairing", async () => {
  const response = await fetch(`${base}/health`, { headers: { Origin: origin } });
  assert.deepEqual(await response.json(), { ok: true, version: 1, pairingRequired: true });
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  assert.equal((await fetch(`${base}/snapshot`, { headers: { Origin: origin } })).status, 401);
  assert.equal((await fetch(`${base}/events`, { headers: { Origin: origin } })).status, 401);
});
test("collects a valid snapshot of this computer after pairing", async () => {
  const response = await fetch(`${base}/snapshot`, { headers: headers() });
  assert.equal(response.status, 200);
  const data: unknown = await response.json();
  assert.ok(isTelemetry(data));
  assert.ok(data.cpu.cores > 0 && data.memory.total > 0);
  assert.equal(data.cpu.perCore.length, data.cpu.cores);
});
test("denies rebinding, unapproved sites, and tokens from another approved origin", async () => {
  const status = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(`${base}/snapshot`, { headers: { ...headers(), host: "rebind.example:8765" } }, response => { response.resume(); resolve(response.statusCode!); });
    request.on("error", reject); request.end();
  });
  assert.equal(status, 403);
  const hostile = await fetch(`${base}/snapshot`, { headers: { ...headers(), Origin: "https://evil.example" } });
  assert.equal(hostile.status, 403); assert.equal(hostile.headers.get("access-control-allow-origin"), null);
  assert.equal((await fetch(`${base}/snapshot`, { headers: { ...headers(), Origin: other } })).status, 401);
  assert.equal((await fetch(`${base}/snapshot`, { headers: { Authorization: `Bearer ${token}` } })).status, 401);
  assert.equal((await pair(code, "https://evil.example")).status, 403);
});
test("permits only approved preflights and bounded pairing requests", async () => {
  const preflight = await fetch(`${base}/events`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization", "Access-Control-Request-Private-Network": "true" } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
  assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");
  assert.equal((await fetch(`${base}/events`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST" } })).status, 403);
  assert.equal((await fetch(`${base}/pair`, { headers: headers() })).status, 405);
  assert.equal((await fetch(`${base}/session`, { headers: headers() })).status, 405);
  assert.equal((await fetch(`${base}/pair`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET" } })).status, 403);
  assert.equal((await fetch(`${base}/events`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "x-unapproved" } })).status, 403);
  assert.equal((await pair("x".repeat(129))).status, 400);
  assert.equal((await fetch(`${base}/pair`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(code) })).status, 400);
});
test("streams successive samples and survives a client disconnect", async () => {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${base}/events`, { headers: headers(), signal: controller.signal });
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    const reader = response.body!.getReader(), decoder = new TextDecoder(), stream = new TelemetryStream();
    const timestamps: number[] = [];
    while (timestamps.length < 2) { const { value, done } = await reader.read(); assert.equal(done, false); for (const snapshot of stream.push(decoder.decode(value, { stream: true }))) timestamps.push(snapshot.timestamp); }
    assert.ok(timestamps[1] > timestamps[0]);
    await reader.cancel();
    assert.equal((await fetch(`${base}/health`)).status, 200);
  } finally { clearTimeout(timeout); controller.abort(); }
});
test("disconnect revokes the browser token", async () => {
  const next = await (await pair(code)).json();
  const sessionHeaders = { Origin: origin, Authorization: `Bearer ${next.token}` };
  assert.equal((await fetch(`${base}/snapshot`, { headers: sessionHeaders })).status, 200);
  assert.equal((await fetch(`${base}/session`, { method: "DELETE", headers: sessionHeaders })).status, 200);
  assert.equal((await fetch(`${base}/snapshot`, { headers: sessionHeaders })).status, 401);
});
test("limits wrong pairing attempts without disclosing the code", async () => {
  for (let i = 0; i < 5; i++) { const response = await pair("000000000000"); assert.equal(response.status, 401); assert.equal((await response.text()).includes(code), false); }
  assert.equal((await pair(code)).status, 429);
});
test("a bundled collector stops when its companion process exits", async () => {
  daemon.kill("SIGTERM"); await once(daemon, "exit");
  const wrapper = spawn(process.execPath, ["-e", `
    const { spawn } = require('node:child_process');
    const child = spawn('./daemon/build/telemetryd', ['--exit-with-parent'], { stdio: ['ignore', 'inherit', 'inherit'] });
    console.log('COLLECTOR_PID: ' + child.pid);
    setInterval(() => {}, 1000);
  `], { stdio: ["ignore", "pipe", "pipe"] });
  let childPid = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(() => reject(new Error("Bundled collector did not start")), 5000);
      wrapper.stdout!.on("data", chunk => { output += String(chunk); const match = output.match(/COLLECTOR_PID: (\d+)/); if (match) childPid = Number(match[1]); if (childPid && output.includes("PAIRING_CODE:")) { clearTimeout(timeout); resolve(); } });
      wrapper.stderr!.on("data", chunk => { clearTimeout(timeout); reject(new Error(String(chunk))); });
    });
    assert.equal((await fetch(`${base}/health`)).status, 200);
    wrapper.kill("SIGTERM"); await once(wrapper, "exit");
    const deadline = Date.now() + 4000;
    let stopped = false;
    while (Date.now() < deadline) {
      try { await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) }); }
      catch { stopped = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(stopped, "Collector left its listener running after the companion exited");
  } finally {
    if (wrapper.exitCode === null && wrapper.signalCode === null) wrapper.kill("SIGTERM");
    if (childPid) { try { process.kill(childPid, "SIGTERM"); } catch { /* Already stopped. */ } }
  }
});
