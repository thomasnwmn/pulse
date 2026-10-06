import { test } from "node:test";
import assert from "node:assert/strict";
import { demoSnapshot } from "../src/lib/demo";
import { isTelemetry, componentLoad } from "../src/lib/telemetry";

test("accepts native-compatible snapshots and unavailable sensor values", () => {
  const snapshot = demoSnapshot(1700000000000);
  assert.equal(isTelemetry(snapshot), true);
  snapshot.gpu = { model: "Unavailable", usage: null, temperature: null, memoryUsed: null, memoryTotal: null };
  snapshot.storage.activity = null;
  snapshot.cpu.temperature = null;
  assert.equal(isTelemetry(snapshot), true);
  assert.equal(componentLoad(snapshot, "gpu"), null);
  assert.equal(componentLoad(snapshot, "storage"), null);
});

test("rejects malformed events instead of breaking the dashboard", () => {
  const valid = demoSnapshot();
  const malformed = [null, [], {}, { ...valid, version: 2 }, { ...valid, timestamp: NaN }, { ...valid, cpu: { ...valid.cpu, usage: 120 } }, { ...valid, cpu: { ...valid.cpu, perCore: ["bad"] } }, { ...valid, memory: { ...valid.memory, total: -1 } }, { ...valid, gpu: { ...valid.gpu, usage: "unknown" } }, { ...valid, processes: [{ pid: 1, name: "Process", cpu: 0 }] }, { ...valid, network: null }];
  malformed.forEach(value => assert.equal(isTelemetry(value), false));
});

test("bounds process payload sizes", () => {
  const valid = demoSnapshot();
  assert.equal(isTelemetry({ ...valid, processes: Array(1001).fill(valid.processes[0]) }), false);
  assert.equal(isTelemetry({ ...valid, system: { ...valid.system, hostname: "a".repeat(1025) } }), false);
});

test("rejects impossible core, utilization, and capacity values", () => {
  const valid = demoSnapshot();
  assert.equal(isTelemetry({ ...valid, cpu: { ...valid.cpu, cores: 3.5 } }), false);
  assert.equal(isTelemetry({ ...valid, cpu: { ...valid.cpu, perCore: [] } }), false);
  assert.equal(isTelemetry({ ...valid, gpu: { ...valid.gpu, usage: 101 } }), false);
  assert.equal(isTelemetry({ ...valid, storage: { ...valid.storage, used: valid.storage.total + 1 } }), false);
  assert.equal(isTelemetry({ ...valid, memory: { ...valid.memory, used: valid.memory.total + 1 } }), false);
});
