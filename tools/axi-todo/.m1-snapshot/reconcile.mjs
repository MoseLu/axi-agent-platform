import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
const snapshotDir = "/Volumes/code/workspace/agent-cluster/axi-agent/tools/axi-todo/.m1-snapshot";
const json = JSON.parse(await fs.readFile(path.join(snapshotDir, "json-tasks.json"), "utf8"));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL || "postgresql:///axi_todo" });
await client.connect();
const pgRes = await client.query("select id, title, status, task_domain, updated_at from tasks order by updated_at desc");
const pgRows = pgRes.rows;
const jsonIds = new Set(json.tasks.map((t) => t.id));
const pgIds = new Set(pgRows.map((t) => t.id));
const overlap = [...pgIds].filter((id) => jsonIds.has(id));
const jsonOnly = json.tasks.filter((t) => !pgIds.has(t.id));
const pgOnly = pgRows.filter((t) => !jsonIds.has(t.id));
const statusMismatches = [];
for (const id of overlap) {
  const j = json.tasks.find((t) => t.id === id);
  const p = pgRows.find((t) => t.id === id);
  if (j.status !== p.status) statusMismatches.push({ id, json: j.status, pg: p.status, title: j.title });
}
const summary = {
  capturedAt: new Date().toISOString(),
  json: { total: json.tasks.length, byStatus: countBy(json.tasks, "status") },
  pg: { total: pgRows.length, byStatus: countBy(pgRows, "status") },
  overlap: overlap.length,
  jsonOnly: jsonOnly.map((t) => ({ id: t.id, status: t.status, title: t.title, updatedAt: t.updatedAt })),
  pgOnly: pgOnly.map((t) => ({ id: t.id, status: t.status, title: t.title, updatedAt: t.updated_at })),
  statusMismatches,
};
await fs.writeFile(path.join(snapshotDir, "reconcile-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await client.end();
function countBy(arr, key) {
  const m = {};
  for (const item of arr) m[item[key] ?? "unknown"] = (m[item[key] ?? "unknown"] ?? 0) + 1;
  return m;
}
