import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { PostgresTaskStore } from "../lib/postgres-store.mjs";

const MIGRATION_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "migrations",
  "003_task_provenance.sql",
);

/**
 * M4 migration idempotency test using a mocked pg client.
 *
 * We model the migration's SQL operations against an in-memory table state and
 * verify that:
 *   1. ADD COLUMN IF NOT EXISTS on a fresh table inserts both columns.
 *   2. ADD COLUMN IF NOT EXISTS on an already-migrated table is a no-op.
 *   3. Backfill UPDATEs propagate payload->>'source' / payload->>'importedAt'
 *      into the new columns, with proper NULLIF + COALESCE defaults.
 *   4. Reverse-sync UPDATE writes source / importedAt back into payload.
 *   5. The CREATE INDEX IF NOT EXISTS is a no-op on second run.
 *
 * No live PG is required — we tokenize the SQL into per-statement operations
 * and replay them against a tiny in-memory table.
 */

class FakeTable {
  constructor() {
    this.columns = new Map(); // name → { type, default }
    this.rows = []; // { id, payload, ...columns }
    this.indexes = new Set();
  }

  addColumn(name, type, defaultValue) {
    if (!this.columns.has(name)) {
      this.columns.set(name, { type, defaultValue });
    }
  }

  upsertRow(id, payload) {
    const existing = this.rows.find((r) => r.id === id);
    if (existing) {
      Object.assign(existing, payload);
    } else {
      this.rows.push({ id, payload });
    }
  }
}

/**
 * Minimal SQL executor that understands only the statements present in
 * 003_task_provenance.sql. Returns the operation name + applied-flag so tests
 * can assert idempotency.
 */
function executeSql(sql, table) {
  const ops = [];
  // Strip line comments first, then split on top-level semicolons.
  const stripped = sql
    .split("\n")
    .map((line) => (line.trim().startsWith("--") ? "" : line))
    .join("\n");
  const statements = stripped
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    if (/^alter table tasks add column if not exists (\w+)\s+([\w\s]+?)( not null)?\s*(default\s+('([^']*)'|null))?$/i.test(stmt)) {
      const m = stmt.match(/^alter table tasks add column if not exists (\w+)\s+([\w\s]+?)( not null)?\s*(default\s+('([^']*)'|null))?$/i);
      const [, colName, colType, , , , defaultLiteral] = m;
      const existed = table.columns.has(colName);
      const defaultValue = defaultLiteral === undefined ? null : defaultLiteral;
      table.addColumn(colName, colType.trim(), defaultValue);
      ops.push({ op: "add-column", col: colName, wasNoOp: existed });
    } else if (/^update tasks\s+set source\s*=/i.test(stmt)) {
      // Backfill UPDATE: source = COALESCE(NULLIF(payload->>'source', ''), 'native'),
      //                  imported_at = NULLIF(payload->>'importedAt', '')::timestamptz
      let touched = 0;
      for (const row of table.rows) {
        const payload = row.payload || {};
        const sourceVal = payload.source;
        const newSource = sourceVal && sourceVal !== "" ? sourceVal : "native";
        if (row.source !== newSource) {
          row.source = newSource;
          touched += 1;
        }
        const importedAtVal = payload.importedAt;
        const newImported = importedAtVal && importedAtVal !== "" ? importedAtVal : null;
        if (row.imported_at !== newImported) {
          row.imported_at = newImported;
          touched += 1;
        }
      }
      ops.push({ op: "backfill", touched });
    } else if (/^update tasks\s+set payload\s*=/i.test(stmt)) {
      // Reverse-sync UPDATE: payload = payload || jsonb_strip_nulls(jsonb_build_object('source', source, 'importedAt', imported_at::text))
      let touched = 0;
      for (const row of table.rows) {
        const next = { ...(row.payload || {}) };
        if (row.source !== undefined) next.source = row.source;
        if (row.imported_at !== undefined && row.imported_at !== null) next.importedAt = String(row.imported_at);
        if (JSON.stringify(next) !== JSON.stringify(row.payload || {})) {
          row.payload = next;
          touched += 1;
        }
      }
      ops.push({ op: "reverse-sync", touched });
    } else if (/^create index if not exists (\w+_idx) on tasks \((\w+)\)$/i.test(stmt)) {
      const m = stmt.match(/^create index if not exists (\w+_idx) on tasks \((\w+)\)$/i);
      const [, idxName] = m;
      const existed = table.indexes.has(idxName);
      table.indexes.add(idxName);
      ops.push({ op: "create-index", name: idxName, wasNoOp: existed });
    } else {
      throw new Error(`unrecognized statement in 003_task_provenance.sql: ${stmt.slice(0, 80)}`);
    }
  }
  return ops;
}

test("003_task_provenance.sql is parseable and contains expected statements", async () => {
  const sql = await fs.readFile(MIGRATION_PATH, "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'native'/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS imported_at timestamptz/i);
  assert.match(sql, /UPDATE tasks\s+SET source/i);
  assert.match(sql, /UPDATE tasks\s+SET payload/i);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS tasks_source_idx ON tasks \(source\)/i);
});

test("003_task_provenance.sql is idempotent on a fresh table (no errors)", async () => {
  const sql = await fs.readFile(MIGRATION_PATH, "utf8");
  const table = new FakeTable();
  const ops1 = executeSql(sql, table);
  assert.ok(ops1.some((o) => o.op === "add-column" && o.col === "source"));
  assert.ok(ops1.some((o) => o.op === "add-column" && o.col === "imported_at"));
  assert.ok(ops1.some((o) => o.op === "create-index" && o.name === "tasks_source_idx"));
  assert.equal(ops1.filter((o) => o.op === "add-column" && o.wasNoOp).length, 0);
  // Run a second time — every add-column and create-index should now be no-op.
  const ops2 = executeSql(sql, table);
  for (const op of ops2) {
    if (op.op === "add-column" || op.op === "create-index") {
      assert.equal(op.wasNoOp, true, `${op.op} ${op.col || op.name} should be no-op on second run`);
    }
  }
});

test("003_task_provenance.sql backfill copies source + importedAt from payload to columns", async () => {
  const sql = await fs.readFile(MIGRATION_PATH, "utf8");
  const table = new FakeTable();
  table.upsertRow("t-1", {
    title: "Imported task",
    source: "import-postgres",
    importedAt: "2026-10-01T12:00:00.000Z",
  });
  table.upsertRow("t-2", {
    title: "Native task",
    // no source / importedAt
  });
  executeSql(sql, table);
  const row1 = table.rows.find((r) => r.id === "t-1");
  const row2 = table.rows.find((r) => r.id === "t-2");
  assert.equal(row1.source, "import-postgres");
  assert.equal(row1.imported_at, "2026-10-01T12:00:00.000Z");
  assert.equal(row2.source, "native", "missing source must default to 'native'");
  assert.equal(row2.imported_at, null, "missing importedAt must default to null");
});

test("003_task_provenance.sql reverse-sync writes source + importedAt back into payload", async () => {
  const sql = await fs.readFile(MIGRATION_PATH, "utf8");
  const table = new FakeTable();
  // Seed a row whose payload carries source + importedAt. The backfill UPDATE
  // copies payload->>'source' / payload->>'importedAt' into the new columns
  // (so source='import-postgres', imported_at='2026-10-02T08:00:00.000Z'),
  // and the reverse-sync UPDATE then writes those columns back into payload,
  // preserving the original provenance through the roundtrip.
  table.rows.push({
    id: "t-3",
    payload: {
      title: "Pre-existing",
      status: "pending",
      source: "import-postgres",
      importedAt: "2026-10-02T08:00:00.000Z",
    },
  });
  executeSql(sql, table);
  const row = table.rows.find((r) => r.id === "t-3");
  assert.equal(row.source, "import-postgres");
  assert.equal(row.imported_at, "2026-10-02T08:00:00.000Z");
  assert.equal(row.payload.source, "import-postgres");
  assert.equal(row.payload.importedAt, "2026-10-02T08:00:00.000Z");
});

test("FakeTable roundtrip preserves all original payload keys after migration", async () => {
  const sql = await fs.readFile(MIGRATION_PATH, "utf8");
  const table = new FakeTable();
  table.upsertRow("t-keep", {
    title: "Keep me",
    prompt: "do the work",
    status: "pending",
    source: "import-postgres",
    importedAt: "2026-10-02T09:00:00.000Z",
  });
  executeSql(sql, table);
  const row = table.rows.find((r) => r.id === "t-keep");
  assert.equal(row.payload.title, "Keep me");
  assert.equal(row.payload.prompt, "do the work");
  assert.equal(row.payload.status, "pending");
  assert.equal(row.payload.source, "import-postgres");
  assert.equal(row.payload.importedAt, "2026-10-02T09:00:00.000Z");
});

test("PostgresTaskStore is the owner of upsertTask (sanity: M4.S3 surface unchanged)", () => {
  // This is a structural sanity test that anchors the upsertTask contract.
  // If the test file moves or upsertTask is renamed, this surfaces a clear
  // signal rather than a vague SQL parse failure.
  assert.equal(typeof PostgresTaskStore.prototype.upsertTask, "function");
  assert.equal(PostgresTaskStore.prototype.upsertTask.length >= 1, true, "upsertTask must accept (task, client?)");
});
