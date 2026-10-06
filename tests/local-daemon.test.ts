import { test } from "node:test";
import assert from "node:assert/strict";
import { demoSnapshot } from "../src/lib/demo";
import { isSession, TelemetryStream } from "../src/lib/local-daemon";

test("parses fragmented and batched telemetry events without losing samples", () => {
  const first = demoSnapshot(), second = demoSnapshot();
  const stream = new TelemetryStream();
  const event = `data: ${JSON.stringify(first)}\n\n`;
  assert.deepEqual(stream.push(event.slice(0, 30)), []);
  assert.deepEqual(stream.push(event.slice(30, -1)), []);
  assert.deepEqual(stream.push(event.slice(-1) + `: heartbeat\n\ndata: ${JSON.stringify(second)}\n\n`), [first, second]);
});
test("rejects malformed readings and unbounded stream frames", () => {
  assert.throws(() => new TelemetryStream().push('data: {"version":1}\n\n'));
  assert.throws(() => new TelemetryStream().push("x".repeat(1024 * 1024 + 1)));
});
test("restores only valid, unexpired companion sessions", () => {
  const token = "a".repeat(64);
  assert.ok(isSession({ token, expires: Date.now() + 10000 }));
  assert.equal(isSession({ token, expires: Date.now() - 1 }), false);
  assert.equal(isSession({ token: "bad", expires: Date.now() + 10000 }), false);
  assert.equal(isSession({ token, expires: "tomorrow" }), false);
});
