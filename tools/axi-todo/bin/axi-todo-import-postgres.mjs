#!/usr/bin/env node
// Reentrant PG → JSON importer for Axi Todo.
//
// M2 motivation: the Swift desktop bridge is structurally bound to JSON, so
// JSON is canonical and PG is opt-in. This tool is the only sanctioned path
// for PG data to "enter" the canonical store. It is intentionally one-way
// (no delete, no overwrite, no schema change in PG) and reentrant (a
// `.imported-pg-ids.json` ledger next to tasks.json records which PG task
// ids have already been brought across, so re-running skips them).
//
// Usage:
//   node bin/axi-todo-import-postgres.mjs              # import all new PG rows
//   node bin/axi-todo-import-postgres.mjs --dry-run    # list without writing
//   AXI_TODO_HOME=/path node bin/axi-todo-import-postgres.mjs
//
// Exit codes:
//   0  success (zero or more rows imported)
//   1  database connection / query failure
//   2  importer error (write failure, schema mismatch, etc.)

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { TaskStore, createStoreFromEnv } from "../lib/store.mjs";
import { defaultAxiTodoHome, nowIso } from "../lib/schema.mjs";

const DRY_RUN = process.argv.includes("--dry-run");

function resolveDatabaseUrl() {
  // M2.S4 drops the implicit `postgresql:///axi_todo` fallback from
  // migrate-postgres.mjs; the importer follows the same env-var contract so
  // operators have one place to set the URL. We do not silently default to
  // anything because the previous default has caused real "looks connected,
  // actually empty DB" incidents (see M2 ledger outOfScopeButFlagged).
  const url = process.env.DATABASE_URL || process.env.AXI_TODO_DATABASE_URL;
  if (!url) {
    process.stderr.write(
      "axi-todo-import-postgres: DATABASE_URL (or AXI_TODO_DATABASE_URL) is required.\n" +
        "Refusing to silently fall back to an implicit database URL.\n",
    );
    process.exit(1);
  }
  return url;
}

async function loadImportedIds(home) {
  const ledgerPath = path.join(home, ".imported-pg-ids.json");
  try {
    const raw = await fs.readFile(ledgerPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.ids)) {
      return { ledgerPath, ids: new Set(parsed.ids.map(String)) };
    }
    return { ledgerPath, ids: new Set() };
  } catch (error) {
    if (error?.code === "ENOENT") return { ledgerPath, ids: new Set() };
    throw error;
  }
}

async function saveImportedIds(ledgerPath, ids) {
  const payload = {
    schemaVersion: 1,
    capturedAt: nowIso(),
    ids: [...ids].sort(),
  };
  await fs.writeFile(ledgerPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function readPgTasks(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // We read `payload` (jsonb) because it is the full task object the PG
    // store serialised; using it lets `createTask()` re-validate every field
    // and lets us splice `source`/`importedAt` provenance in one place.
    const result = await client.query(
      "select id, payload, created_at from tasks order by created_at asc, id asc",
    );
    return result.rows;
  } finally {
    await client.end();
  }
}

function buildImportInput(row, importedAt) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  // Preserve every field, then splice provenance. createTask() ignores
  // unknown keys, so this is safe even if PG has schema drift.
  return {
    ...payload,
    id: payload.id || row.id,
    // Provenance: M2 contract — every JSON task that originated in PG carries
    // both markers so reconcilers and audits can distinguish imported rows.
    source: "import-postgres",
    importedAt,
  };
}

// Pure-ish orchestrator: given a TaskStore + a list of PG rows, decide what
// to import, run the writes, and return a summary. Exported so tests can
// exercise the import flow without spawning a child process or opening a
// real `pg.Client` connection.
export async function runImport({ store, home, rows, dryRun = false, capturedAt = nowIso(), databaseUrl = "memory" } = {}) {
  let existingJsonIds = new Set();
  try {
    const state = await store.readState();
    existingJsonIds = new Set(state.tasks.map((task) => task.id));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const { ledgerPath, ids: importedIds } = await loadImportedIds(home);
  const plan = [];
  for (const row of rows) {
    const id = row?.payload?.id || row?.id;
    if (!id) continue;
    if (importedIds.has(id)) plan.push({ id, action: "skip-already-imported" });
    else if (existingJsonIds.has(id)) plan.push({ id, action: "skip-already-in-json" });
    else plan.push({ id, action: "import" });
  }

  const toImport = plan.filter((entry) => entry.action === "import");
  const summary = {
    capturedAt,
    dryRun,
    home,
    databaseUrl: databaseUrl.replace(/:[^/@]*@/, ":***@"),
    ledgerPath,
    pgRowsScanned: rows.length,
    alreadyImported: plan.filter((entry) => entry.action === "skip-already-imported").length,
    alreadyInJson: plan.filter((entry) => entry.action === "skip-already-in-json").length,
    toImport: toImport.length,
    toImportIds: toImport.map((entry) => entry.id),
  };

  if (dryRun || toImport.length === 0) {
    return summary;
  }

  const importedAt = nowIso();
  let importedCount = 0;
  const newIds = new Set(importedIds);
  for (const entry of toImport) {
    const row = rows.find((candidate) => (candidate?.payload?.id || candidate?.id) === entry.id);
    if (!row) continue;
    const input = buildImportInput(row, importedAt);
    await store.addTask(input);
    newIds.add(entry.id);
    importedCount += 1;
  }
  await saveImportedIds(ledgerPath, newIds);
  return {
    ...summary,
    importedNow: importedCount,
    importedIds: toImport.map((entry) => entry.id),
  };
}

async function main() {
  const databaseUrl = resolveDatabaseUrl();
  const home = defaultAxiTodoHome();
  const store = new TaskStore({ home });
  const rows = await readPgTasks(databaseUrl);
  const summary = await runImport({ store, home, rows, dryRun: DRY_RUN, capturedAt: nowIso(), databaseUrl });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

// CLI entry point guard: only run `main()` when this file is the process
// entry, so tests can `import { runImport } from "..."` without side effects.
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`axi-todo-import-postgres: ${error?.stack || error?.message || error}\n`);
    process.exit(2);
  });
}

// Touch createStoreFromEnv so an import test that uses --dry-run against a
// process without DATABASE_URL still exercises the same env-var contract as
// the main importer path (defensive — no runtime side effect).
void createStoreFromEnv;
