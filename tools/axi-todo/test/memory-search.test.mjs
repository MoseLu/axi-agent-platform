import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TaskStore } from "../lib/store.mjs";
import { PostgresTaskStore } from "../lib/postgres-store.mjs";
import {
  MEMORY_SEARCH_FIELDS,
  buildPlanningMemoryLikeExpression,
  searchCollectionText,
} from "../lib/memory-search.mjs";

const FIXTURE_UUID = "11111111-1111-1111-1111-111111111111";

function makeFixtureState() {
  return {
    planningRecords: [
      {
        id: FIXTURE_UUID,
        planningSummary: "Split auth refactor into 4 milestones",
        splitRationale: "boundary between schema and runtime",
        granularityAssessment: "fine-grained per module",
        modelRationale: "use local qwen3:30b",
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        planningSummary: "Migrate logs to structured jsonl",
        splitRationale: "preserve backward compatibility",
        granularityAssessment: "chunk by file",
        modelRationale: "use minimax-m3",
      },
    ],
    failureAnalyses: [
      {
        id: "33333333-3333-3333-3333-333333333333",
        rootCause: "PG timeout during transaction",
        trigger: "long-running audit query",
        failureStage: "verification",
        recoveryAction: "switch to smaller batches",
        avoidNextTime: "always set statement_timeout",
      },
    ],
    completionSummaries: [
      {
        id: "44444444-4444-4444-4444-444444444444",
        summary: "M2 unified ledger landed across JSON and PG",
        nextTimeNotes: "mirror ledger schema in migrations",
        auditVerdict: "pass",
      },
    ],
    memoryCards: [
      {
        id: "55555555-5555-5555-5555-555555555555",
        title: "PG split-tx audit pattern",
        content: "Use withClient to wrap audit insert and status flip in one transaction",
      },
    ],
  };
}

async function seedJsonStore(home, fixture) {
  const store = new TaskStore({ home });
  for (const item of fixture.planningRecords) {
    await store.appendRecord("planningRecords", item);
  }
  for (const item of fixture.failureAnalyses) {
    await store.appendRecord("failureAnalyses", item);
  }
  for (const item of fixture.completionSummaries) {
    await store.appendRecord("completionSummaries", item);
  }
  for (const item of fixture.memoryCards) {
    await store.appendRecord("memoryCards", item);
  }
  return store;
}

function makeMockedPgStore(fixture) {
  const pg = Object.create(PostgresTaskStore.prototype);
  pg.pool = {
    async query(sql, params) {
      // Build a flat row set from the JSON fixture so the SQL path can exercise
      // the same data the JSON store sees. We don't actually parse the SQL —
      // we rely on the LIKE matcher the helper emits and the union shape.
      const lowered = String(params[0] || "").toLowerCase().replace(/%/g, "");
      const limit = params[1] || 20;
      const rows = [];
      for (const record of fixture.planningRecords) {
        rows.push({ source: "planning_records", payload: record });
      }
      for (const record of fixture.failureAnalyses) {
        rows.push({ source: "failure_analyses", payload: record });
      }
      for (const record of fixture.completionSummaries) {
        rows.push({ source: "completion_summaries", payload: record });
      }
      for (const record of fixture.memoryCards) {
        rows.push({ source: "memory_cards", payload: record });
      }
      const matched = rows.filter((row) => {
        const fields = MEMORY_SEARCH_FIELDS[row.source].jsonFields;
        return fields.some((field) => {
          const value = row.payload[field];
          if (value == null) return false;
          return String(value).toLowerCase().includes(lowered);
        });
      });
      return { rows: matched.slice(-limit) };
    },
  };
  return pg;
}

function fromDbRecord(payload) {
  return { ...payload };
}

function normalizeRows(rows) {
  return rows
    .map((row) => ({ source: row.source, id: row.id }))
    .sort((a, b) =>
      a.source === b.source ? String(a.id).localeCompare(String(b.id)) : a.source.localeCompare(b.source)
    );
}

test("MEMORY_SEARCH_FIELDS exposes pgColumns + jsonFields for all 4 collections", () => {
  for (const source of [
    "planning_records",
    "failure_analyses",
    "completion_summaries",
    "memory_cards",
  ]) {
    const entry = MEMORY_SEARCH_FIELDS[source];
    assert.ok(Array.isArray(entry.pgColumns) && entry.pgColumns.length > 0, `${source}.pgColumns`);
    assert.ok(Array.isArray(entry.jsonFields) && entry.jsonFields.length > 0, `${source}.jsonFields`);
  }
});

test("searchCollectionText only inspects whitelisted fields per source", () => {
  const record = {
    id: "id-1",
    leakedSecret: "needle-should-not-match",
    planningSummary: "needle should match here",
  };
  // id leak must not match (this is the regression we fixed)
  assert.equal(searchCollectionText(record, "planning_records", "needle-should-not-match"), false);
  assert.equal(searchCollectionText(record, "planning_records", "needle should match here"), true);
  assert.equal(searchCollectionText({ ...record, leakedSecret: undefined }, "planning_records", ""), true);
  assert.equal(searchCollectionText(record, "unknown_collection", "anything"), false);
});

test("buildPlanningMemoryLikeExpression emits 4-collection UNION ALL with bound params", () => {
  const { sql, params } = buildPlanningMemoryLikeExpression({ needlePattern: "%foo%", limit: 5 });
  assert.match(sql, /select 'planning_records' as source/i);
  assert.match(sql, /select 'failure_analyses' as source/i);
  assert.match(sql, /select 'completion_summaries' as source/i);
  assert.match(sql, /select 'memory_cards' as source/i);
  assert.match(sql, /limit \$2/i);
  assert.deepEqual(params, ["%foo%", 5]);
});

test("buildPlanningMemoryLikeExpression rejects non-string needlePattern", () => {
  assert.throws(() => buildPlanningMemoryLikeExpression({ needlePattern: 123 }));
  assert.throws(() => buildPlanningMemoryLikeExpression({ needlePattern: undefined }));
});

test("JSON and mocked PG return identical {source, id} row sets for 5 queries", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-memsearch-"));
  const fixture = makeFixtureState();
  const jsonStore = await seedJsonStore(home, fixture);
  const pgStore = makeMockedPgStore(fixture);

  const queries = [
    "",
    "structured",
    "split",
    "audit",
    "transaction",
  ];
  for (const q of queries) {
    const jsonRows = await jsonStore.searchPlanningMemory({ query: q, limit: 20 });
    const pgRows = await pgStore.searchPlanningMemory({ query: q, limit: 20 });
    assert.deepEqual(
      normalizeRows(pgRows),
      normalizeRows(jsonRows),
      `parity drift on query ${JSON.stringify(q)}`
    );
  }
});

test("JSON searchPlanningMemory no longer leaks task ids as needle matches", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-memsearch-idleak-"));
  const fixture = makeFixtureState();
  const jsonStore = await seedJsonStore(home, fixture);

  // Querying for a UUID that lives in fixture.id fields must NOT return any row,
  // because IDs are not on the per-collection whitelist.
  const hits = await jsonStore.searchPlanningMemory({ query: FIXTURE_UUID, limit: 20 });
  assert.equal(hits.length, 0, `UUID ${FIXTURE_UUID} leaked through JSON.stringify match`);
});

test("mocked PG searchPlanningMemory respects whitelist (no id leak either)", async () => {
  const fixture = makeFixtureState();
  const pgStore = makeMockedPgStore(fixture);
  const hits = await pgStore.searchPlanningMemory({ query: FIXTURE_UUID, limit: 20 });
  assert.equal(hits.length, 0, `UUID ${FIXTURE_UUID} leaked through PG whitelist`);
});
