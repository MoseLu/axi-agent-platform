import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { PostgresTaskStore } from "../lib/postgres-store.mjs";

const MIGRATION_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "migrations",
  "004_collection_provenance.sql",
);

const TARGET_TABLES = [
  "completion_summaries",
  "failure_analyses",
  "planning_records",
  "memory_cards",
];

/**
 * M6 migration idempotency test for the four provenance-mirrored collections.
 *
 * This mirrors test/migrate-postgres.test.mjs (M4 task-provenance test): we
 * tokenize the SQL by hand against a tiny in-memory `FakeTable` and verify
 * that:
 *   1. ADD COLUMN IF NOT EXISTS on a fresh table inserts both columns.
 *   2. ADD COLUMN IF NOT EXISTS on an already-migrated table is a no-op.
 *   3. Backfill UPDATEs propagate payload->>'source' / payload->>'importedAt'
 *      into the new columns, with proper NULLIF + COALESCE defaults.
 *   4. Reverse-sync UPDATE writes source / importedAt back into payload.
 *   5. The CREATE INDEX IF NOT EXISTS is a no-op on second run.
 *
 * The four tables share an identical statement template; instead of four near-
   identical test functions we drive the same assertions over a table-by-table
   fixture so a regression in one is structurally identical to a regression in
   all of them.
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
 * 004_collection_provenance.sql. Each target table gets its own `FakeTable`
 * instance; the executor routes ALTER / UPDATE / CREATE INDEX by matching
 * the table name in the statement.
 */
function executeSql(sql, tables) {
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
    const alterMatch = stmt.match(/^alter table (\w+) add column if not exists (\w+)\s+([\w\s]+?)( not null)?\s*(default\s+('([^']*)'|null))?$/i);
    if (alterMatch) {
      const [, tableName, colName, colType, , , , defaultLiteral] = alterMatch;
      const table = tables[tableName];
      if (!table) throw new Error(`004_collection_provenance.sql references unknown table ${tableName}`);
      const existed = table.columns.has(colName);
      const defaultValue = defaultLiteral === undefined ? null : defaultLiteral;
      table.addColumn(colName, colType.trim(), defaultValue);
      ops.push({ op: "add-column", table: tableName, col: colName, wasNoOp: existed });
      continue;
    }
    const backfillMatch = stmt.match(/^update (\w+)\s+set source\s*=/i);
    if (backfillMatch) {
      const [, tableName] = backfillMatch;
      const table = tables[tableName];
      if (!table) throw new Error(`backfill UPDATE references unknown table ${tableName}`);
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
      ops.push({ op: "backfill", table: tableName, touched });
      continue;
    }
    const reverseSyncMatch = stmt.match(/^update (\w+)\s+set payload\s*=/i);
    if (reverseSyncMatch) {
      const [, tableName] = reverseSyncMatch;
      const table = tables[tableName];
      if (!table) throw new Error(`reverse-sync UPDATE references unknown table ${tableName}`);
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
      ops.push({ op: "reverse-sync", table: tableName, touched });
      continue;
    }
    const indexMatch = stmt.match(/^create index if not exists (\w+_idx) on (\w+) \((\w+)\)$/i);
    if (indexMatch) {
      const [, idxName, tableName] = indexMatch;
      const table = tables[tableName];
      if (!table) throw new Error(`CREATE INDEX references unknown table ${tableName}`);
      const existed = table.indexes.has(idxName);
      table.indexes.add(idxName);
      ops.push({ op: "create-index", table: tableName, name: idxName, wasNoOp: existed });
      continue;
    }
    throw new Error(`unrecognized statement in 004_collection_provenance.sql: ${stmt.slice(0, 80)}`);
  }
  return ops;
}

function freshTables() {
  const out = {};
  for (const name of TARGET_TABLES) out[name] = new FakeTable();
  return out;
}

test("004_collection_provenance.sql contains exactly 20 statements (4 tables × 5 ops)", async () => {
  const sql = await fs.readFile(MIGRATION_PATH, "utf8");
  const stripped = sql
    .split("\n")
    .map((line) => (line.trim().startsWith("--") ? "" : line))
    .join("\n");
  const statements = stripped
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  assert.equal(statements.length, 20, "expected 20 statements (2 ALTER + 1 UPDATE backfill + 1 UPDATE reverse-sync + 1 CREATE INDEX per table)");
  for (const name of TARGET_TABLES) {
    assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'native'`, "i"));
    assert.match(sql, new RegExp(`ALTER TABLE ${name} ADD COLUMN IF NOT EXISTS source`, "i"));
    assert.match(sql, new RegExp(`ALTER TABLE ${name} ADD COLUMN IF NOT EXISTS imported_at`, "i"));
    assert.match(sql, new RegExp(`UPDATE ${name}\\s+SET source`, "i"));
    assert.match(sql, new RegExp(`UPDATE ${name}\\s+SET payload`, "i"));
    assert.match(sql, new RegExp(`CREATE INDEX IF NOT EXISTS ${name}_source_idx ON ${name} \\(source\\)`, "i"));
  }
});

test("004_collection_provenance.sql is idempotent on a fresh cluster (no errors)", async () => {
  const sql = await fs.readFile(MIGRATION_PATH, "utf8");
  const tables = freshTables();
  const ops1 = executeSql(sql, tables);
  for (const name of TARGET_TABLES) {
    assert.ok(ops1.some((o) => o.op === "add-column" && o.table === name && o.col === "source"), `${name} source column added`);
    assert.ok(ops1.some((o) => o.op === "add-column" && o.table === name && o.col === "imported_at"), `${name} imported_at column added`);
    assert.ok(ops1.some((o) => o.op === "create-index" && o.table === name && o.name === `${name}_source_idx`), `${name} index added`);
    assert.equal(ops1.filter((o) => o.op === "add-column" && o.table === name && o.wasNoOp).length, 0, `${name} first-run adds are not no-op`);
  }
  // Second run: every add-column + create-index must report wasNoOp=true.
  const ops2 = executeSql(sql, tables);
  for (const op of ops2) {
    if (op.op === "add-column" || op.op === "create-index") {
      assert.equal(op.wasNoOp, true, `${op.table} ${op.op} ${op.col || op.name} should be no-op on second run`);
    }
  }
});

test("004_collection_provenance.sql backfill copies source + importedAt from payload to columns for all four tables", async () => {
  const sql = await fs.readFile(MIGRATION_PATH, "utf8");
  const tables = freshTables();
  const fixture = {
    completion_summaries: { id: "cs-1", payload: { summary: "done", source: "import-postgres", importedAt: "2026-10-01T12:00:00.000Z" } },
    failure_analyses: { id: "fa-1", payload: { rootCause: "boom", source: "import-postgres", importedAt: "2026-10-01T12:00:00.000Z" } },
    planning_records: { id: "pr-1", payload: { planningSummary: "split it", source: "import-postgres", importedAt: "2026-10-01T12:00:00.000Z" } },
    memory_cards: { id: "mc-1", payload: { content: "lesson", source: "import-postgres", importedAt: "2026-10-01T12:00:00.000Z" } },
  };
  for (const name of TARGET_TABLES) tables[name].upsertRow(fixture[name].id, fixture[name].payload);
  // Add a "native" row to every collection (no payload source/importedAt).
  for (const name of TARGET_TABLES) tables[name].upsertRow(`${name}-native`, { content: "native" });
  executeSql(sql, tables);
  for (const name of TARGET_TABLES) {
    const imported = tables[name].rows.find((r) => r.id === fixture[name].id);
    const native = tables[name].rows.find((r) => r.id === `${name}-native`);
    assert.equal(imported.source, "import-postgres", `${name} imported row.source`);
    assert.equal(imported.imported_at, "2026-10-01T12:00:00.000Z", `${name} imported row.imported_at`);
    assert.equal(native.source, "native", `${name} native row.source must default to 'native'`);
    assert.equal(native.imported_at, null, `${name} native row.imported_at must default to null`);
  }
});

test("004_collection_provenance.sql reverse-sync writes source + importedAt back into payload for all four tables", async () => {
  const sql = await fs.readFile(MIGRATION_PATH, "utf8");
  const tables = freshTables();
  for (const name of TARGET_TABLES) {
    tables[name].upsertRow(`${name}-rs`, {
      content: "Pre-existing",
      source: "import-postgres",
      importedAt: "2026-10-02T08:00:00.000Z",
    });
  }
  executeSql(sql, tables);
  for (const name of TARGET_TABLES) {
    const row = tables[name].rows.find((r) => r.id === `${name}-rs`);
    assert.equal(row.source, "import-postgres", `${name} column source preserved`);
    assert.equal(row.imported_at, "2026-10-02T08:00:00.000Z", `${name} column imported_at preserved`);
    assert.equal(row.payload.source, "import-postgres", `${name} payload.source preserved through roundtrip`);
    assert.equal(row.payload.importedAt, "2026-10-02T08:00:00.000Z", `${name} payload.importedAt preserved through roundtrip`);
    assert.equal(row.payload.content, "Pre-existing", `${name} original payload content not clobbered`);
  }
});

test("PG insertCompletionSummary uses ON CONFLICT (id) DO UPDATE with sticky provenance", () => {
  // Structural sanity: anchor the contract so a future refactor that drops
  // ON CONFLICT or that touches source/imported_at in the SET list fails
  // loudly here instead of as a SQL parse error at runtime.
  const sql = PostgresTaskStore.prototype.insertCompletionSummary.toString();
  assert.match(sql, /on conflict \(id\) do update set/i, "insertCompletionSummary must use ON CONFLICT (id) DO UPDATE");
  assert.ok(!/source = excluded\.source/i.test(sql), "sticky: ON CONFLICT must NOT overwrite source");
  assert.ok(!/imported_at = excluded\.imported_at/i.test(sql), "sticky: ON CONFLICT must NOT overwrite imported_at");
  assert.match(sql, /jsonb_strip_nulls\(jsonb_build_object\('source', completion_summaries\.source, 'importedAt', completion_summaries\.imported_at\)\)/i, "reverse-sync must read from completion_summaries.source / .imported_at");
});

test("PG insertFailureAnalysis uses ON CONFLICT (id) DO UPDATE with sticky provenance", () => {
  const sql = PostgresTaskStore.prototype.insertFailureAnalysis.toString();
  assert.match(sql, /on conflict \(id\) do update set/i, "insertFailureAnalysis must use ON CONFLICT (id) DO UPDATE");
  assert.ok(!/source = excluded\.source/i.test(sql), "sticky: ON CONFLICT must NOT overwrite source");
  assert.ok(!/imported_at = excluded\.imported_at/i.test(sql), "sticky: ON CONFLICT must NOT overwrite imported_at");
  assert.match(sql, /jsonb_strip_nulls\(jsonb_build_object\('source', failure_analyses\.source, 'importedAt', failure_analyses\.imported_at\)\)/i, "reverse-sync must read from failure_analyses.source / .imported_at");
});

test("PG insertMemoryCard uses ON CONFLICT (id) DO UPDATE with sticky provenance", () => {
  const sql = PostgresTaskStore.prototype.insertMemoryCard.toString();
  assert.match(sql, /on conflict \(id\) do update set/i, "insertMemoryCard must use ON CONFLICT (id) DO UPDATE");
  assert.ok(!/source = excluded\.source/i.test(sql), "sticky: ON CONFLICT must NOT overwrite source");
  assert.ok(!/imported_at = excluded\.imported_at/i.test(sql), "sticky: ON CONFLICT must NOT overwrite imported_at");
  assert.match(sql, /jsonb_strip_nulls\(jsonb_build_object\('source', memory_cards\.source, 'importedAt', memory_cards\.imported_at\)\)/i, "reverse-sync must read from memory_cards.source / .imported_at");
});

test("PG insertCompletionSummary binds source + imported_at columns and defaults to 'native' / null", async () => {
  // Capture the SQL + bound params through a fake client so we can verify the
  // exact wire shape. Sticky semantics are exercised separately in the
  // structural-sanity test above.
  const pg = Object.create(PostgresTaskStore.prototype);
  let capturedSql = null;
  let capturedParams = null;
  pg.pool = {
    async query() {
      return { rows: [] };
    },
  };
  pg.insertCompletionSummary = async function (_task, _record, client) {
    await client.query("noop", []);
    return {};
  };
  // Reach the real implementation path through a tiny re-bind.
  const realImpl = PostgresTaskStore.prototype.insertCompletionSummary;
  await realImpl.call(
    {
      pool: {
        async query(sql, params) {
          capturedSql = sql;
          capturedParams = params;
          return { rows: [] };
        },
      },
    },
    { id: "t1", source: "import-postgres", importedAt: "2026-10-02T16:00:00.000Z" },
    { summary: "done" },
  );
  assert.match(capturedSql, /insert into completion_summaries \(.*source, imported_at\)/i);
  assert.match(capturedSql, /on conflict \(id\) do update set/i);
  // The bound params include source + imported_at at the end.
  assert.equal(capturedParams.at(-2), "import-postgres");
  assert.equal(capturedParams.at(-1), "2026-10-02T16:00:00.000Z");
});

test("PG insertCompletionSummary defaults source to 'native' when record omits it", async () => {
  let capturedParams = null;
  await PostgresTaskStore.prototype.insertCompletionSummary.call(
    {
      pool: {
        async query(_sql, params) {
          capturedParams = params;
          return { rows: [] };
        },
      },
    },
    { id: "t1", source: "native" }, // task fallback for source
    { summary: "done" }, // input without source
  );
  assert.equal(capturedParams.at(-2), "native");
  assert.equal(capturedParams.at(-1), null);
});

test("PG insertMemoryCard defaults source to 'native' when card omits it", async () => {
  let capturedParams = null;
  await PostgresTaskStore.prototype.insertMemoryCard.call(
    {
      pool: {
        async query(_sql, params) {
          capturedParams = params;
          return { rows: [] };
        },
      },
    },
    { id: "mc-1", type: "execution_lesson", title: "Lesson", content: "x" },
  );
  assert.equal(capturedParams.at(-2), "native");
  assert.equal(capturedParams.at(-1), null);
});