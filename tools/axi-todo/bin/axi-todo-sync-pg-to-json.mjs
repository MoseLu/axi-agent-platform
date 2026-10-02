#!/usr/bin/env node
// Owner-gated PG → JSON reverse-sync for Axi Todo.
//
// M6 motivation: M2 set "JSON canonical, PG opt-in" and shipped
// `bin/axi-todo-import-postgres.mjs` for the JSON←PG direction. But when a
// Swift desktop bridge runs without the importer, PG data stays orphaned in
// PG while the Swift install reads a stale JSON. This tool is the missing
// half: when an operator explicitly selects `AXI_TODO_STORE=postgres` (or
// `auto`), it reads PG state and merges them into the canonical JSON ledger.
//
// Strict rules (each is a real failure mode, not a stylistic preference):
//   - JSON is canonical — when a row already exists in JSON, NEVER silently
//     overwrite, regardless of which side has the newer `updatedAt`. The
//     owner must re-import manually if they really want to clobber.
//   - Owner-gated — dry-run by default; `--apply` requires `--confirm-apply`
//     (double-flag confirmation, same pattern as M5.S5).
//   - Reentrant — `.synced-pg-to-json-ids.json` next to `.imported-pg-ids.json`
//     records which PG ids have been merged into JSON. Re-runs skip them.
//   - No implicit DATABASE_URL default — same env-var contract as the importer
//     (M2.S4 lesson: implicit `postgresql:///axi_todo` has caused real
//     "looks connected, actually empty DB" incidents).
//
// Usage:
//   node bin/axi-todo-sync-pg-to-json.mjs                       # dry-run (default)
//   node bin/axi-todo-sync-pg-to-json.mjs --apply --confirm-apply
//   node bin/axi-todo-sync-pg-to-json.mjs --apply --confirm-apply \
//     --only-collections=tasks,completion_summaries
//   AXI_TODO_HOME=/path node bin/axi-todo-sync-pg-to-json.mjs --apply --confirm-apply
//
// Exit codes:
//   0  success (zero or more rows merged)
//   1  database connection / query failure OR owner-gate refusal
//   2  sync error (write failure, schema mismatch, etc.)

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { TaskStore, createStoreFromEnv } from "../lib/store.mjs";
import { defaultAxiTodoHome, nowIso, createTask, normalizeState } from "../lib/schema.mjs";

// All non-task collections share the same merge shape (record + id column).
// We special-case `tasks` because its rows are wrapped in a `payload` jsonb
// and must flow through `createTask()` to be safely added.
const ALL_COLLECTIONS = [
  "tasks",
  "taskCharters",
  "planningRecords",
  "taskRuns",
  "taskEvents",
  "failureAnalyses",
  "auditReviews",
  "userPreferences",
  "completionSummaries",
  "memoryCards",
];

function parseArgs(argv) {
  const tokens = argv.slice(2);
  const apply = tokens.includes("--apply");
  const confirmApply = tokens.includes("--confirm-apply");
  const onlyToken = tokens.find((t) => t.startsWith("--only-collections="));
  const onlyCollections = onlyToken
    ? onlyToken
        .split("=")[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map(toCamelCase)
    : null;
  return {
    apply,
    confirmApply,
    dryRun: !(apply && confirmApply),
    onlyCollections,
  };
}

function toCamelCase(name) {
  return String(name).replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function resolveCollections(parsedArgs) {
  if (!parsedArgs.onlyCollections) return ALL_COLLECTIONS.slice();
  const wanted = new Set(parsedArgs.onlyCollections);
  return ALL_COLLECTIONS.filter((c) => wanted.has(c));
}

function resolveDatabaseUrl(env = process.env) {
  // M2.S4: no implicit default. Same env-var contract as the importer and
  // the migrator. We do NOT fall back to `postgresql:///axi_todo` because
  // that has caused real "looks connected, actually empty DB" incidents.
  const url = env.DATABASE_URL || env.AXI_TODO_DATABASE_URL;
  if (!url) {
    process.stderr.write(
      "axi-todo-sync-pg-to-json: DATABASE_URL (or AXI_TODO_DATABASE_URL) is required.\n" +
        "Refusing to silently fall back to an implicit database URL.\n",
    );
    process.exit(1);
  }
  return url;
}

function assertOwnerGate(parsedArgs) {
  // Mirror M5.S5: --apply without --confirm-apply exits 1 with stderr
  // message. No silent fallback. Operators must explicitly pass both flags.
  if (parsedArgs.apply && !parsedArgs.confirmApply) {
    process.stderr.write(
      "axi-todo-sync-pg-to-json: refusing to mutate JSON without owner confirmation.\n" +
        "Re-run with BOTH --apply AND --confirm-apply to enable writes.\n",
    );
    process.exit(1);
  }
}

async function loadSyncedIds(home) {
  const ledgerPath = path.join(home, ".synced-pg-to-json-ids.json");
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

async function saveSyncedIds(ledgerPath, ids) {
  const payload = {
    schemaVersion: 1,
    capturedAt: nowIso(),
    ids: [...ids].sort(),
  };
  await fs.writeFile(ledgerPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function readPgState(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // We `select id, payload, created_at, updated_at from tasks` because the
    // task shape lives entirely inside the `payload` jsonb (matching the M4
    // reverse-sync contract) and we need `updated_at` for the "PG newer than
    // JSON" warning. Other collections are flat: `select *` so we capture
    // every column the row has. The camelCase translation happens after.
    const queries = [
      [
        "tasks",
        "select id, payload, created_at, updated_at from tasks order by created_at asc, id asc",
      ],
      ["taskCharters", "select * from task_charters order by created_at asc"],
      ["planningRecords", "select * from planning_records order by created_at asc"],
      ["taskRuns", "select * from task_runs order by created_at asc"],
      ["taskEvents", "select * from task_events order by created_at asc"],
      ["failureAnalyses", "select * from failure_analyses order by created_at asc"],
      ["auditReviews", "select * from audit_reviews order by created_at asc"],
      ["userPreferences", "select * from user_preferences order by created_at asc"],
      ["completionSummaries", "select * from completion_summaries order by created_at asc"],
      ["memoryCards", "select * from memory_cards order by created_at asc"],
    ];
    const out = {};
    for (const [key, sql] of queries) {
      const result = await client.query(sql);
      out[key] = result.rows;
    }
    return out;
  } finally {
    await client.end();
  }
}

function fromPgRow(row) {
  if (!row || typeof row !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "payload") continue; // handled separately for tasks
    out[toCamelCase(key)] = value;
  }
  return out;
}

function readUpdatedAt(record) {
  if (!record) return undefined;
  const ts = record.updatedAt || record.updated_at;
  if (!ts) return undefined;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : undefined;
}

function findExistingById(state, collection, id) {
  const arr = state[collection];
  if (!Array.isArray(arr)) return null;
  return arr.find((item) => item && item.id === id) || null;
}

function decideAction(row, collection, jsonState, syncedIds) {
  const id = row && row.id;
  if (!id) return { id, action: "skip-missing-id", warn: false };

  if (syncedIds.has(id)) return { id, action: "skip-already-synced", warn: false };

  const existing = findExistingById(jsonState, collection, id);
  if (existing) {
    // JSON canonical wins. The action is always `skip-already-in-json`;
    // we surface a `warn` flag for visibility when both sides have an
    // `updatedAt` and PG is strictly newer (so the operator can audit
    // divergence without us silently clobbering the JSON copy).
    const pgUpdatedAt = readUpdatedAt({ updated_at: row.updated_at });
    const jsonUpdatedAt = readUpdatedAt(existing);
    const pgIsNewer =
      typeof pgUpdatedAt === "number" &&
      typeof jsonUpdatedAt === "number" &&
      pgUpdatedAt > jsonUpdatedAt;
    return { id, action: "skip-already-in-json", warn: pgIsNewer };
  }

  return { id, action: "add", warn: false };
}

async function writeBackupSnapshot(home, jsonState, capturedAt) {
  const backupDir = path.join(home, ".m1-snapshot", "m6-audit");
  await fs.mkdir(backupDir, { recursive: true });
  // ISO timestamps are not safe in filenames on every FS; replace `:` and `.`
  // to keep filenames portable across the operator's possible shells.
  const safe = String(capturedAt).replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `pre-sync-${safe}.json`);
  await fs.writeFile(backupPath, `${JSON.stringify(jsonState, null, 2)}\n`, "utf8");
  return backupPath;
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, filePath);
}

// Pure-ish orchestrator. Testable without spawning child_process or
// opening a real `pg.Client` connection — tests pass `pgState` directly.
export async function runSync({
  store,
  home,
  pgState,
  parsedArgs = { apply: false, confirmApply: false, onlyCollections: null, dryRun: true },
  capturedAt = nowIso(),
  databaseUrl = "memory",
} = {}) {
  if (parsedArgs.apply && !parsedArgs.confirmApply) {
    const err = new Error("refusing to mutate JSON without owner confirmation");
    err.code = "AXI_TODO_SYNC_OWNER_GATE";
    throw err;
  }

  const collections = resolveCollections(parsedArgs);
  const { ledgerPath, ids: syncedIds } = await loadSyncedIds(home);
  const jsonState = await store.readState();

  const planByCollection = {};
  let toAddTotal = 0;
  let skipTotal = 0;
  const warnings = [];

  for (const collection of collections) {
    const rows = Array.isArray(pgState[collection]) ? pgState[collection] : [];
    const decisions = [];
    for (const row of rows) {
      const decision = decideAction(row, collection, jsonState, syncedIds);
      decisions.push(decision);
      if (decision.warn) {
        warnings.push(
          `PG row ${decision.id} in ${collection} is newer than JSON; ` +
            "skipping per JSON-canonical rule (PG.updated_at > JSON.updatedAt)",
        );
      }
    }
    const addCount = decisions.filter((d) => d.action === "add").length;
    planByCollection[collection] = {
      scanned: rows.length,
      addCount,
      skipCounts: {
        "skip-already-synced": decisions.filter((d) => d.action === "skip-already-synced").length,
        "skip-already-in-json": decisions.filter((d) => d.action === "skip-already-in-json").length,
        "skip-missing-id": decisions.filter((d) => d.action === "skip-missing-id").length,
      },
      wouldAddIds: decisions.filter((d) => d.action === "add").map((d) => d.id),
    };
    toAddTotal += addCount;
    skipTotal += decisions.length - addCount;
  }

  const summary = {
    capturedAt,
    apply: Boolean(parsedArgs.apply && parsedArgs.confirmApply),
    dryRun: parsedArgs.dryRun,
    home,
    databaseUrl: databaseUrl.replace(/:[^/@]*@/, ":***@"),
    ledgerPath,
    collections,
    totalScanned: Object.values(planByCollection).reduce((s, c) => s + c.scanned, 0),
    totalAdds: toAddTotal,
    totalSkips: skipTotal,
    warnings,
    planByCollection,
  };

  if (parsedArgs.dryRun || toAddTotal === 0) {
    return summary;
  }

  // Apply mode: backup snapshot before mutation, merge into in-memory state,
  // atomic write, update the reentrant ledger.
  const backupPath = await writeBackupSnapshot(home, jsonState, capturedAt);

  const importedAt = nowIso();
  const addedByCollection = {};
  const newSyncedIds = new Set(syncedIds);

  for (const collection of collections) {
    const rows = Array.isArray(pgState[collection]) ? pgState[collection] : [];
    const addIdSet = new Set(planByCollection[collection].wouldAddIds);
    if (addIdSet.size === 0) continue;
    addedByCollection[collection] = [];
    for (const row of rows) {
      if (!row || !row.id || !addIdSet.has(row.id)) continue;
      if (collection === "tasks") {
        const payload =
          row.payload && typeof row.payload === "object" ? row.payload : {};
        const input = {
          ...payload,
          id: payload.id || row.id,
          // Provenance: every JSON task that originated in PG carries the
          // same marker as the M2 importer so reconcilers / audits can
          // distinguish imported rows from native ones.
          source: "import-postgres",
          importedAt,
        };
        const task = createTask(input, { now: importedAt });
        jsonState.tasks.push(task);
      } else {
        const record = fromPgRow(row);
        record.source = "import-postgres";
        record.importedAt = importedAt;
        if (!Array.isArray(jsonState[collection])) jsonState[collection] = [];
        jsonState[collection].push(record);
      }
      addedByCollection[collection].push(row.id);
      newSyncedIds.add(row.id);
    }
  }

  await writeJsonAtomic(store.filePath, normalizeState(jsonState));
  await saveSyncedIds(ledgerPath, newSyncedIds);

  return {
    ...summary,
    applied: true,
    backupPath,
    addedByCollection,
  };
}

async function main() {
  const parsedArgs = parseArgs(process.argv);
  // Owner-gate check happens BEFORE we open a pg.Client. We never want a
  // caller who forgot `--confirm-apply` to burn a network round-trip.
  assertOwnerGate(parsedArgs);
  const databaseUrl = resolveDatabaseUrl();
  const home = defaultAxiTodoHome();
  const store = new TaskStore({ home });
  const pgState = await readPgState(databaseUrl);
  const summary = await runSync({
    store,
    home,
    pgState,
    parsedArgs,
    capturedAt: nowIso(),
    databaseUrl,
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(
      `axi-todo-sync-pg-to-json: ${error?.stack || error?.message || error}\n`,
    );
    process.exit(2);
  });
}

// Touch createStoreFromEnv so a test that bypasses the CLI still imports the
// same surface the importer/migrator expose (defensive — no runtime side
// effect).
void createStoreFromEnv;