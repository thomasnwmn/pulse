import { test } from "node:test";
import assert from "node:assert/strict";
import { isLocalRequest } from "../src/lib/local-access";

function request(headers: Record<string, string>) { return new Request("http://127.0.0.1:3000/api/telemetry", { headers }); }
test("allows local same-origin access and command-line clients", () => {
  assert.equal(isLocalRequest(request({ host: "127.0.0.1:3000", "sec-fetch-site": "same-origin" })), true);
  assert.equal(isLocalRequest(request({ host: "localhost:3000", origin: "http://localhost:3000" })), true);
  assert.equal(isLocalRequest(request({ host: "127.0.0.1:3000" })), true);
});
test("blocks external origins, rebinding hosts, and other local websites", () => {
  assert.equal(isLocalRequest(request({ host: "evil.example:3000" })), false);
  assert.equal(isLocalRequest(request({ host: "127.0.0.1.evil.example" })), false);
  assert.equal(isLocalRequest(request({ host: "127.0.0.1:3000", origin: "https://evil.example" })), false);
  assert.equal(isLocalRequest(request({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:4000" })), false);
  assert.equal(isLocalRequest(request({ host: "127.0.0.1:3000", "sec-fetch-site": "cross-site" })), false);
  assert.equal(isLocalRequest(request({ host: "127.0.0.1:3000", "sec-fetch-site": "same-site" })), false);
  assert.equal(isLocalRequest(request({})), false);
});
