import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createHeartbeatEnvelope, validateTelemetryEnvelope } = require("../src/telemetry.js");

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const adr = readFileSync("docs/adr/0001-axi-agent-transport.md", "utf8");

assert.equal(pkg.name, "axi-agent-transport");

for (const required of [
  "heartbeat",
  "correlation_id",
  "PowerShell launcher",
  "Do not restore",
  "Python named-pipe IPC",
  "axi-agent-platform",
  "axi-agent-mcp",
]) {
  assert.ok(adr.includes(required), `ADR is missing required decision text: ${required}`);
}

const heartbeat = createHeartbeatEnvelope({
  sessionId: "goal70",
  agentId: "worker-1",
  sequence: 7,
  now: new Date("2026-05-25T00:00:00.000Z"),
});
assert.deepEqual(heartbeat, {
  type: "heartbeat",
  source: "axi-agent-transport",
  session_id: "goal70",
  agent_id: "worker-1",
  correlation_id: "goal70:worker-1:7",
  status: "alive",
  timestamp: "2026-05-25T00:00:00.000Z",
});
assert.equal(validateTelemetryEnvelope(heartbeat), true);

console.log("transport contract ok");
