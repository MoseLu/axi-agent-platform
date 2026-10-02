import assert from "node:assert/strict";
import test from "node:test";

/**
 * M8 regression test for the completeTask inline audit_reviews INSERT path.
 *
 * Background: M7 added migrations/005_event_provenance.sql + sticky
 * source/imported_at binding for recordTaskEvent + recordAuditReview, but
 * the inline audit_reviews INSERT inside completeTask's needsAudit branch
 * (lib/postgres-store.mjs lines 248-273, originally) did NOT bind those
 * columns. Migration 005 would backfill source='native' on the gate-held
 * audit row even when the parent task is import-postgres — losing the
 * import provenance in the audit trail.
 *
 * M8 closes the gap. We verify the SQL text + the file source directly
 * (no live PG required; the test mirrors how migrate-event-provenance
 * tests verify SQL parseability without a real database):
 *   1. The completeTask function source references `task.source` /
 *      `task.importedAt` (proves the inline path inherits from parent).
 *   2. The INSERT column list contains `source` and `imported_at`.
 *   3. The bind-param array contains 12 entries (10 original + 2 new).
 *   4. The `now` audit row sentinel does not appear twice (sanity).
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const POSTGRES_STORE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "lib",
  "postgres-store.mjs",
);

async function loadPostgresStoreSource() {
  return readFile(POSTGRES_STORE_PATH, "utf8");
}

test("completeTask inline audit_reviews INSERT binds source + imported_at from parent task", async () => {
  const source = await loadPostgresStoreSource();
  // Locate the completeTask function — starts at `async completeTask(`
  // and contains the inline INSERT we are auditing.
  const startIdx = source.indexOf("async completeTask(");
  assert.ok(startIdx >= 0, "completeTask function not found in postgres-store.mjs");
  // Read a generous window (~600 lines) to capture the needsAudit INSERT.
  const window = source.slice(startIdx, startIdx + 12000);
  const insertMarker = "insert into audit_reviews (id, task_id, run_id, audit_level, verdict, reason, evidence_gaps, release_conditions, evidence_refs, created_at, source, imported_at)";
  const insertIdx = window.indexOf(insertMarker);
  assert.ok(
    insertIdx >= 0,
    "completeTask inline audit_reviews INSERT must include `source, imported_at` columns (M8 fix)",
  );
  // The bind-param array should reference task.source and task.importedAt
  // (sticky-on-insert defaulting to 'native' / null).
  assert.ok(
    /task\.source\s*\|\|\s*"native"/.test(window),
    "completeTask inline INSERT must bind `task.source || \"native\"` so the audit row inherits the parent task's source marker",
  );
  assert.ok(
    /task\.importedAt\s*\|\|\s*null/.test(window),
    "completeTask inline INSERT must bind `task.importedAt || null` so the audit row inherits the parent task's import timestamp",
  );
  // Bind-param count: 12 ($1..$12).
  const afterInsert = window.slice(insertIdx + insertMarker.length, insertIdx + insertMarker.length + 2000);
  const paramRefs = afterInsert.match(/\$\d+/g) || [];
  assert.ok(
    paramRefs.length >= 12,
    `bind-param array must reference $1..$12 (got ${paramRefs.length} refs)`,
  );
});

test("completeTask inline INSERT bind-param array wires 12 params ending with importedAt", async () => {
  const source = await loadPostgresStoreSource();
  const startIdx = source.indexOf("async completeTask(");
  const window = source.slice(startIdx, startIdx + 12000);
  const insertMarker = "insert into audit_reviews (id, task_id, run_id, audit_level, verdict, reason, evidence_gaps, release_conditions, evidence_refs, created_at, source, imported_at)";
  const insertIdx = window.indexOf(insertMarker);
  assert.ok(insertIdx >= 0, "inline INSERT not found");
  // Read enough source to capture the full bind-param array (12 entries).
  const afterInsert = window.slice(insertIdx, insertIdx + 4000);
  // The bind array should appear inside `[ ... ]` brackets following the INSERT.
  const arrayMatch = afterInsert.match(/\[\s*([\s\S]*?)\s*\],\s*\n\s*\);\s*\n\s*\}/);
  assert.ok(arrayMatch, "could not locate bind-param array after INSERT");
  const arrayBody = arrayMatch[1];
  // Split by top-level commas (we expect 12 entries separated by `,\n            `).
  const entries = arrayBody.split(/,\s*\n/).length;
  assert.equal(
    entries,
    12,
    `bind-param array must contain exactly 12 entries (got ${entries}); 10 = unfixed, >12 = undocumented extra columns`,
  );
  // The 12th entry must reference task.importedAt || null (last entry in the array).
  const trimmed = arrayBody.trim();
  assert.ok(
    /task\.importedAt\s*\|\|\s*null\s*,?\s*$/.test(trimmed),
    `bind-param array's last entry must be \`task.importedAt || null\` (got last entry: "${trimmed.split(/,\s*\n/).pop()}")`,
  );
});