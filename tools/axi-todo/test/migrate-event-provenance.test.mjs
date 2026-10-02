import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { PostgresTaskStore } from "../lib/postgres-store.mjs";

const MIGRATION_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "migrations",
  "005_event_provenance.sql",
);

const TARGET_TABLES = ["audit_reviews", "task_events"];

/**
 * M7 migration idempotency test for the two event-trail tables that carry
 * the runtime audit + history trail: `audit_reviews` and `task_events`.
 *
 * Mirrors test/migrate-collection-provenance.test.mjs (M6): we tokenize the
 * SQL by hand against a tiny in-memory `FakeTable` and verify that:
 *   1. ADD COLUMN IF NOT EXISTS on a fresh table inserts both columns.
 *   2. ADD COLUMN IF NOT EXISTS on an already-migrated table is a no-op.
 *   3. Backfill UPDATEs propagate payload->>'source' / payload->>'importedAt'
 *      into the new columns, with proper NULLIF + COALESCE defaults.
 *   4. Reverse-sync UPDATE writes source / importedAt back into payload.
 *   5. The CREATE INDEX IF NOT EXISTS is a no-op on second run.
 *   6. PG recordTaskEvent / recordAuditReview bind source + imported_at,
 *      omit them from ON CONFLICT DO UPDATE SET (sticky), and reverse-sync
 *      payload from the canonical column values.
 *
 * Both tables share an identical statement template; instead of two near-
 * identical test functions we drive the same assertions over a table-by-table
 * fixture so a regression in one is structurally identical to a regression
 * in both of them.
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
 * 005_event_provenance.sql. Each target table gets its own `FakeTable`
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
      if (!table) throw new Error(`005_event_provenance.sql references unknown table ${tableName}`);
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
    throw new Error(`unrecognized statement in 005_event_provenance.sql: ${stmt.slice(0, 80)}`);
  }
  return ops;
}

function freshTables() {
  const out = {};
  for (const name of TARGET_TABLES) out[name] = new FakeTable();
  return out;
}

test("005_event_provenance.sql contains exactly 10 statements (2 tables × 5 ops)", async () => {
  const sql = await fs.readFile(MIGRATION_PATH, "utf8");
  const stripped = sql
    .split("\n")
    .map((line) => (line.trim().startsWith("--") ? "" : line))
    .join("\n");
  const statements = stripped
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  assert.equal(statements.length, 10, "expected 10 statements (2 ALTER + 1 UPDATE backfill + 1 UPDATE reverse-sync + 1 CREATE INDEX per table)");
  for (const name of TARGET_TABLES) {
    assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'native'`, "i"));
    assert.match(sql, new RegExp(`ALTER TABLE ${name} ADD COLUMN IF NOT EXISTS source`, "i"));
    assert.match(sql, new RegExp(`ALTER TABLE ${name} ADD COLUMN IF NOT EXISTS imported_at`, "i"));
    assert.match(sql, new RegExp(`UPDATE ${name}\\s+SET source`, "i"));
    assert.match(sql, new RegExp(`UPDATE ${name}\\s+SET payload`, "i"));
    assert.match(sql, new RegExp(`CREATE INDEX IF NOT EXISTS ${name}_source_idx ON ${name} \\(source\\)`, "i"));
  }
});

test("005_event_provenance.sql is idempotent on a fresh cluster (no errors)", async () => {
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

test("005_event_provenance.sql backfill copies source + importedAt from payload to columns for both tables", async () => {
  const sql = await fs.readFile(MIGRATION_PATH, "utf8");
  const tables = freshTables();
  const fixture = {
    audit_reviews: { id: "ar-1", payload: { verdict: "pending", reason: "gate held", source: "import-postgres", importedAt: "2026-10-01T12:00:00.000Z" } },
    task_events: { id: "te-1", payload: { eventType: "claimed", message: "claimed", source: "import-postgres", importedAt: "2026-10-01T12:00:00.000Z" } },
  };
  for (const name of TARGET_TABLES) tables[name].upsertRow(fixture[name].id, fixture[name].payload);
  // Add a "native" row to every collection (no payload source/importedAt).
  for (const name of TARGET_TABLES) tables[name].upsertRow(`${name}-native`, { eventType: "native" });
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

test("005_event_provenance.sql reverse-sync writes source + importedAt back into payload for both tables", async () => {
  const sql = await fs.readFile(MIGRATION_PATH, "utf8");
  const tables = freshTables();
  for (const name of TARGET_TABLES) {
    tables[name].upsertRow(`${name}-rs`, {
      eventType: "claimed",
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
    assert.equal(row.payload.eventType, "claimed", `${name} original payload content not clobbered`);
  }
});

test("PG recordTaskEvent uses ON CONFLICT (id) DO UPDATE with sticky provenance", () => {
  // Structural sanity: anchor the contract so a future refactor that drops
  // ON CONFLICT or that touches source/imported_at in the SET list fails
  // loudly here instead of as a SQL parse error at runtime.
  const sql = PostgresTaskStore.prototype.recordTaskEvent.toString();
  assert.match(sql, /on conflict \(id\) do update set/i, "recordTaskEvent must use ON CONFLICT (id) DO UPDATE");
  assert.ok(!/source = excluded\.source/i.test(sql), "sticky: ON CONFLICT must NOT overwrite source");
  assert.ok(!/imported_at = excluded\.imported_at/i.test(sql), "sticky: ON CONFLICT must NOT overwrite imported_at");
  assert.match(sql, /jsonb_strip_nulls\(jsonb_build_object\('source', task_events\.source, 'importedAt', task_events\.imported_at\)\)/i, "reverse-sync must read from task_events.source / .imported_at");
});

test("PG recordAuditReview uses ON CONFLICT (id) DO UPDATE with sticky provenance (audit_reviews + audit_waiting task_events)", () => {
  // Structural sanity for both inserts inside the M3.S4 withClient transaction.
  const sql = PostgresTaskStore.prototype.recordAuditReview.toString();
  // audit_reviews INSERT: sticky + reverse-sync.
  assert.match(sql, /insert into audit_reviews \(.*source, imported_at\)/i, "audit_reviews INSERT must bind source + imported_at");
  assert.ok(!/audit_reviews\.source\s*=\s*excluded\.source/i.test(sql), "sticky: audit_reviews ON CONFLICT must NOT overwrite source");
  assert.ok(!/audit_reviews\.imported_at\s*=\s*excluded\.imported_at/i.test(sql), "sticky: audit_reviews ON CONFLICT must NOT overwrite imported_at");
  assert.match(sql, /jsonb_strip_nulls\(jsonb_build_object\('source', audit_reviews\.source, 'importedAt', audit_reviews\.imported_at\)\)/i, "audit_reviews reverse-sync must read from audit_reviews.source / .imported_at");
  // audit_waiting task_events INSERT (M3.S4 second write): sticky + reverse-sync.
  // The function body has two distinct `insert into task_events` blocks — the
  // audit_waiting one (inside recordAuditReview) and the standalone one
  // (inside recordTaskEvent). We require the audit_one to also have sticky
  // semantics, not just raw regex count.
  const auditWaitingBlock = sql.match(/insert into task_events[\s\S]+?on conflict \(id\) do update set[\s\S]+?jsonb_build_object\('source', task_events\.source, 'importedAt', task_events\.imported_at\)/i);
  assert.ok(auditWaitingBlock, "audit_waiting task_events INSERT inside recordAuditReview must use sticky + reverse-sync");
  assert.ok(!/task_events\.source\s*=\s*excluded\.source/i.test(sql), "sticky: task_events ON CONFLICT must NOT overwrite source (anywhere in recordAuditReview)");
  assert.ok(!/task_events\.imported_at\s*=\s*excluded\.imported_at/i.test(sql), "sticky: task_events ON CONFLICT must NOT overwrite imported_at (anywhere in recordAuditReview)");
});

test("PG recordTaskEvent binds source + imported_at columns and defaults to 'native' / null", async () => {
  // Capture the SQL + bound params through a fake pool so we can verify the
  // exact wire shape. Sticky semantics are exercised separately in the
  // structural-sanity test above.
  let capturedSql = null;
  let capturedParams = null;
  await PostgresTaskStore.prototype.recordTaskEvent.call(
    {
      pool: {
        async query(sql, params) {
          capturedSql = sql;
          capturedParams = params;
          return { rows: [] };
        },
      },
    },
    { id: "te-1", source: "import-postgres", importedAt: "2026-10-02T16:00:00.000Z" },
  );
  assert.match(capturedSql, /insert into task_events \(.*source, imported_at\)/i);
  assert.match(capturedSql, /on conflict \(id\) do update set/i);
  // The bound params include source + imported_at at the end.
  assert.equal(capturedParams.at(-2), "import-postgres");
  assert.equal(capturedParams.at(-1), "2026-10-02T16:00:00.000Z");
});

test("PG recordTaskEvent defaults source to 'native' when input omits it", async () => {
  let capturedParams = null;
  await PostgresTaskStore.prototype.recordTaskEvent.call(
    {
      pool: {
        async query(_sql, params) {
          capturedParams = params;
          return { rows: [] };
        },
      },
    },
    { id: "te-2", eventType: "completed", message: "done" },
  );
  assert.equal(capturedParams.at(-2), "native");
  assert.equal(capturedParams.at(-1), null);
});

test("PG recordAuditReview binds source + imported_at on both writes (withClient audit + audit_waiting)", async () => {
  // Verify the audit_reviews INSERT binds source + imported_at at the end of
  // its params list. The M3.S4 withClient wrapper hides the second insert,
  // but its SQL must already carry the new columns by construction (we
  // asserted that structurally above; here we just smoke-test the wire
  // shape on the first insert).
  let capturedSql = null;
  let capturedParams = null;
  const fakeClient = {
    async query(sql, params) {
      // Capture the first insert into audit_reviews (skip the audit_waiting
      // task_events insert — that one is exercised structurally above).
      if (sql.startsWith("insert into audit_reviews") && !capturedSql) {
        capturedSql = sql;
        capturedParams = params;
      }
      return { rows: [] };
    },
    release() {},
  };
  const fakePool = {
    async connect() {
      return fakeClient;
    },
    async query() {
      return { rows: [] };
    },
  };
  const store = Object.create(PostgresTaskStore.prototype);
  store.pool = fakePool;
  // Stub getTaskForUpdate + upsertTask so the audit_waiting branch (verdict
  // != 'pass') can fire without needing a real `tasks` row.
  store.getTaskForUpdate = async () => ({ id: "task-1", status: "completed" });
  store.upsertTask = async () => {};
  // Drive a "fail" verdict so the audit_waiting branch also fires.
  await store.recordAuditReview({
    id: "ar-1",
    taskId: "task-1",
    verdict: "fail",
    reason: "evidence missing",
    source: "import-postgres",
    importedAt: "2026-10-02T16:00:00.000Z",
  });
  assert.ok(capturedSql, "audit_reviews INSERT must have been captured");
  assert.match(capturedSql, /insert into audit_reviews \(.*source, imported_at\)/i);
  // The audit_reviews INSERT params end with source + imported_at.
  assert.equal(capturedParams.at(-2), "import-postgres");
  assert.equal(capturedParams.at(-1), "2026-10-02T16:00:00.000Z");
  // Sticky: ON CONFLICT must be present.
  assert.match(capturedSql, /on conflict \(id\) do update set/i);
});

test("PG recordAuditReview wraps all writes in withClient (M3.S4 transaction semantics preserved)", async () => {
  // Critical regression guard: the M3.S4 commit (150fac5) introduced a
  // single withClient transaction wrapping audit insert + status flip +
  // audit_waiting task_events row. A future refactor that drops withClient
  // re-opens the rollback gap. Verify by recording the calls in order.
  const calls = [];
  const fakeClient = {
    async query(sql, params) {
      // Capture the leading two SQL tokens so "insert into audit_reviews"
      // and "insert into task_events" stay distinct from BEGIN / COMMIT.
      calls.push({ rawSql: sql, head: sql.trim().split(/\s+/).slice(0, 2).join(" ").toLowerCase(), params });
      return { rows: [] };
    },
    release() {},
  };
  const fakePool = {
    async connect() {
      calls.push({ rawSql: "connect", head: "connect" });
      return fakeClient;
    },
    async query(sql) {
      calls.push({ rawSql: sql, head: sql.trim().split(/\s+/).slice(0, 2).join(" ").toLowerCase(), pool: true });
      return { rows: [] };
    },
  };
  const store = Object.create(PostgresTaskStore.prototype);
  store.pool = fakePool;
  store.getTaskForUpdate = async () => ({ id: "task-2", status: "completed" });
  store.upsertTask = async () => {};
  await store.recordAuditReview({
    id: "ar-2",
    taskId: "task-2",
    verdict: "fail",
    reason: "gate",
  });
  // withClient must have grabbed a single client connection.
  const connectCalls = calls.filter((c) => c.head === "connect");
  assert.equal(connectCalls.length, 1, "withClient must acquire exactly one connection per recordAuditReview call");
  // All audit_reviews / task_events writes must use the client (not the
  // pool), and must be bracketed by begin / commit on the client.
  const clientWrites = calls.filter((c) => !c.pool);
  assert.ok(clientWrites.some((c) => c.head === "begin"), "withClient must issue BEGIN on the client");
  assert.ok(clientWrites.some((c) => c.head === "commit"), "withClient must issue COMMIT on the client");
  // The audit_reviews INSERT must come BEFORE the audit_waiting task_events
  // INSERT — the audit row must commit first so the history event attaches
  // to a real audit (rollback on the history event rolls back audit + status).
  const insertOrder = clientWrites.filter((c) => c.head.startsWith("insert into")).map((c) => c.head);
  const auditIdx = insertOrder.findIndex((s) => s === "insert into");
  // (audit_reviews / task_events collapse to the same `head` because the
  // head only keeps the first two tokens; the actual sql differs and is
  // captured in rawSql.)
  const auditReviewsCalls = clientWrites.filter((c) => /insert into audit_reviews/i.test(c.rawSql));
  const taskEventsCalls = clientWrites.filter((c) => /insert into task_events/i.test(c.rawSql));
  assert.ok(auditReviewsCalls.length >= 1, "audit_reviews INSERT must fire");
  assert.ok(taskEventsCalls.length >= 1, "audit_waiting task_events INSERT must fire");
  // Audit row must precede audit_waiting event in the recorded order.
  const firstAudit = calls.indexOf(auditReviewsCalls[0]);
  const firstEvent = calls.indexOf(taskEventsCalls[0]);
  assert.ok(firstAudit < firstEvent, `audit_reviews INSERT (idx=${firstAudit}) must precede audit_waiting task_events INSERT (idx=${firstEvent})`);
});

test("PG recordAuditReview defaults source to 'native' / null when input omits it", async () => {
  let capturedParams = null;
  const fakeClient = {
    async query(sql, params) {
      if (sql.startsWith("insert into audit_reviews") && !capturedParams) {
        capturedParams = params;
      }
      return { rows: [] };
    },
    release() {},
  };
  const fakePool = {
    async connect() {
      return fakeClient;
    },
    async query() {
      return { rows: [] };
    },
  };
  const store = Object.create(PostgresTaskStore.prototype);
  store.pool = fakePool;
  // Pass verdict:'pass' so we skip the audit_waiting branch and just
  // exercise the audit_reviews INSERT defaults.
  await store.recordAuditReview({ id: "ar-3", taskId: "task-3", verdict: "pass" });
  assert.equal(capturedParams.at(-2), "native");
  assert.equal(capturedParams.at(-1), null);
});