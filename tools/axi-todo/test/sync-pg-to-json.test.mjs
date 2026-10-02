import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TaskStore } from "../lib/store.mjs";
import { runSync } from "../bin/axi-todo-sync-pg-to-json.mjs";

const CLI_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "bin",
  "axi-todo-sync-pg-to-json.mjs",
);

function makePgTaskRow(id, overrides = {}) {
  // Mirrors the PG `tasks.payload` jsonb shape plus the unique normalized
  // columns the tool SELECTs (`id, payload, created_at, updated_at`).
  const now = new Date().toISOString();
  return {
    id,
    created_at: now,
    updated_at: now,
    payload: {
      id,
      title: `PG task ${id}`,
      prompt: `prompt for ${id}`,
      cwd: "/tmp",
      status: "pending",
      priority: 0,
      attempts: 0,
      maxAttempts: 3,
      dueAt: now,
      acceptanceChecks: [],
      auditLevel: "none",
      riskLevel: "medium",
      taskKind: "task",
      dependsOn: [],
      resourceKeys: [],
      rejectedApproaches: [],
      waitState: {},
      verification: {},
      createdAt: now,
      updatedAt: now,
      history: [],
      ...overrides,
    },
  };
}

function makePgSummaryRow(id, overrides = {}) {
  // Mirrors the PG `completion_summaries` row shape (snake_case columns
  // returned by `select *`). Tests use this for the `select *` collections.
  const now = new Date().toISOString();
  return {
    id,
    task_id: "pg-task",
    run_id: null,
    status: "completed",
    summary: `summary for ${id}`,
    duration_ms: 0,
    verification: {},
    evidence_refs: [],
    audit_verdict: null,
    next_time_notes: null,
    created_at: now,
    ...overrides,
  };
}

function emptyPgState() {
  return {
    tasks: [],
    taskCharters: [],
    planningRecords: [],
    taskRuns: [],
    taskEvents: [],
    failureAnalyses: [],
    auditReviews: [],
    userPreferences: [],
    completionSummaries: [],
    memoryCards: [],
  };
}

const DRY_RUN_ARGS = { apply: false, confirmApply: false, onlyCollections: null, dryRun: true };
const APPLY_ARGS = { apply: true, confirmApply: true, onlyCollections: null, dryRun: false };

test("--apply without --confirm-apply is refused at the CLI with exit 1", () => {
  // The owner-gate runs before the pg.Client connect; we intentionally do
  // NOT pass DATABASE_URL here so we also prove the gate fires regardless.
  const result = spawnSync("node", [CLI_PATH, "--apply"], {
    env: { ...process.env, DATABASE_URL: "", AXI_TODO_DATABASE_URL: "" },
    encoding: "utf8",
  });
  assert.equal(result.status, 1, `expected exit 1; got ${result.status}: ${result.stderr}`);
  assert.match(result.stderr, /refusing to mutate JSON without owner confirmation/);
  assert.match(result.stderr, /--apply AND --confirm-apply/);
});

test("--apply without --confirm-apply is also refused at runSync() (throws owner-gate error)", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-sync-owner-gate-"));
  const store = new TaskStore({ home });
  await assert.rejects(
    runSync({
      store,
      home,
      pgState: emptyPgState(),
      parsedArgs: { apply: true, confirmApply: false, onlyCollections: null, dryRun: false },
    }),
    (error) => error && error.code === "AXI_TODO_SYNC_OWNER_GATE",
  );
});

test("runSync dry-run on empty PG state reports zero changes and no JSON mutation", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-sync-empty-"));
  const store = new TaskStore({ home });
  const summary = await runSync({
    store,
    home,
    pgState: emptyPgState(),
    parsedArgs: DRY_RUN_ARGS,
    databaseUrl: "memory://test",
  });

  assert.equal(summary.dryRun, true);
  assert.equal(summary.apply, false);
  assert.equal(summary.totalScanned, 0);
  assert.equal(summary.totalAdds, 0);
  assert.equal(summary.totalSkips, 0);
  assert.deepEqual(summary.warnings, []);
  // No ledger should have been created on dry-run.
  await assert.rejects(
    fs.readFile(path.join(home, ".synced-pg-to-json-ids.json"), "utf8"),
    (error) => error.code === "ENOENT",
  );
  // No JSON file should exist.
  await assert.rejects(fs.readFile(path.join(home, "tasks.json"), "utf8"), (error) => error.code === "ENOENT");
});

test("runSync dry-run with new ids not in JSON lists them as 'would add' without mutation", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-sync-dryrun-new-"));
  const store = new TaskStore({ home });
  const pgState = {
    ...emptyPgState(),
    tasks: [makePgTaskRow("pg-a"), makePgTaskRow("pg-b", { title: "PG row pg-b", prompt: "b prompt", status: "completed", auditLevel: "strict" })],
    completionSummaries: [makePgSummaryRow("cs-1")],
  };

  const summary = await runSync({
    store,
    home,
    pgState,
    parsedArgs: DRY_RUN_ARGS,
    databaseUrl: "memory://test",
  });

  assert.equal(summary.dryRun, true);
  assert.equal(summary.totalAdds, 3, "2 tasks + 1 summary should be marked add");
  assert.equal(summary.totalSkips, 0);
  assert.deepEqual(summary.planByCollection.tasks.wouldAddIds, ["pg-a", "pg-b"]);
  assert.deepEqual(summary.planByCollection.completionSummaries.wouldAddIds, ["cs-1"]);

  // Critical: dry-run MUST NOT write tasks.json.
  await assert.rejects(fs.readFile(path.join(home, "tasks.json"), "utf8"), (error) => error.code === "ENOENT");
  // And MUST NOT write the reentrant ledger either.
  await assert.rejects(
    fs.readFile(path.join(home, ".synced-pg-to-json-ids.json"), "utf8"),
    (error) => error.code === "ENOENT",
  );
});

test("runSync --apply --confirm-apply writes new ids into JSON with provenance + backup snapshot", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "cat-sync-apply-new-"));
  const store = new TaskStore({ home });
  const pgState = {
    ...emptyPgState(),
    tasks: [
      makePgTaskRow("pg-a"),
      makePgTaskRow("pg-b", { title: "PG row pg-b", prompt: "b prompt", status: "completed", auditLevel: "strict" }),
    ],
    completionSummaries: [makePgSummaryRow("cs-1", { summary: "summary text" })],
  };

  const summary = await runSync({
    store,
    home,
    pgState,
    parsedArgs: APPLY_ARGS,
    databaseUrl: "memory://test",
  });

  assert.equal(summary.applied, true);
  assert.equal(summary.apply, true);
  assert.equal(summary.totalAdds, 3);
  assert.ok(summary.backupPath, "apply mode must produce a backupPath");
  assert.equal(summary.addedByCollection.tasks.length, 2);
  assert.equal(summary.addedByCollection.completionSummaries.length, 1);

  // Backup snapshot was written AND its content reflects pre-merge state.
  // At the moment of backup, JSON was empty, so the file should be the
  // empty-state skeleton (version: 3, tasks: []).
  const backupRaw = await fs.readFile(summary.backupPath, "utf8");
  const backup = JSON.parse(backupRaw);
  assert.equal(backup.version, 3);
  assert.deepEqual(backup.tasks, []);
  assert.ok(summary.backupPath.includes("pre-sync-"), "backup filename uses pre-sync-<ISO>");

  // JSON state now has the merged rows.
  const state = await store.readState();
  assert.equal(state.tasks.length, 2);
  const byId = Object.fromEntries(state.tasks.map((t) => [t.id, t]));
  assert.equal(byId["pg-a"].title, "PG task pg-a");
  assert.equal(byId["pg-a"].source, "import-postgres");
  assert.ok(byId["pg-a"].importedAt);
  assert.equal(byId["pg-b"].status, "completed");
  assert.equal(byId["pg-b"].auditLevel, "strict");
  assert.equal(state.completionSummaries.length, 1);
  assert.equal(state.completionSummaries[0].id, "cs-1");
  // Provenance is also applied to non-task collections.
  assert.equal(state.completionSummaries[0].source, "import-postgres");
  assert.ok(state.completionSummaries[0].importedAt);
  // Snake_case columns were translated to camelCase on the JSON record.
  assert.equal(state.completionSummaries[0].taskId, "pg-task");
  assert.ok(state.completionSummaries[0].createdAt);

  // Reentrant ledger was written with the three new ids.
  const ledgerRaw = await fs.readFile(path.join(home, ".synced-pg-to-json-ids.json"), "utf8");
  const ledger = JSON.parse(ledgerRaw);
  assert.equal(ledger.schemaVersion, 1);
  assert.deepEqual(ledger.ids.sort(), ["cs-1", "pg-a", "pg-b"]);
});

test("runSync --apply --confirm-apply skips ids present in JSON (JSON newer than PG: no overwrite)", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "cat-sync-skip-newer-"));
  const store = new TaskStore({ home });

  // Seed JSON with an existing task that has a NEWER updatedAt than the PG row.
  // store.addTask stamps createdAt/updatedAt to now() automatically.
  const existing = await store.addTask({
    id: "pg-existing",
    title: "Already in JSON",
    prompt: "pre-existing prompt",
    cwd: home,
    status: "pending",
  });
  const jsonUpdatedAt = existing.updatedAt;

  // PG row: same id but a different title and a slightly older timestamp
  // so we exercise the "JSON is newer than PG" branch — the spec says we
  // must skip with no overwrite. We don't strictly need both branches here
  // because the action is identical, but the title-clobber assertion proves
  // the JSON copy is untouched.
  const pgState = {
    ...emptyPgState(),
    tasks: [
      {
        id: "pg-existing",
        created_at: "2026-01-01T00:00:00.000Z",
        // PG updated_at is OLDER than JSON: this is the "JSON newer" branch.
        updated_at: new Date(Date.parse(jsonUpdatedAt) - 60_000).toISOString(),
        payload: {
          id: "pg-existing",
          title: "PG newer version (would clobber)",
          prompt: "different prompt",
          cwd: "/tmp",
          status: "completed",
          priority: 0,
          attempts: 0,
          maxAttempts: 3,
          dueAt: "2026-01-01T00:00:00.000Z",
          acceptanceChecks: [],
          auditLevel: "strict",
          riskLevel: "medium",
          taskKind: "task",
          dependsOn: [],
          resourceKeys: [],
          rejectedApproaches: [],
          waitState: {},
          verification: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          history: [],
        },
      },
      makePgTaskRow("pg-fresh"),
    ],
  };

  const summary = await runSync({
    store,
    home,
    pgState,
    parsedArgs: APPLY_ARGS,
    databaseUrl: "memory://test",
  });

  // pg-existing → skip-already-in-json (no warning: JSON is newer).
  // pg-fresh → add.
  assert.equal(summary.totalAdds, 1);
  assert.equal(summary.totalSkips, 1);
  assert.equal(summary.planByCollection.tasks.skipCounts["skip-already-in-json"], 1);
  assert.deepEqual(summary.planByCollection.tasks.wouldAddIds, ["pg-fresh"]);

  const state = await store.readState();
  const afterTask = state.tasks.find((t) => t.id === "pg-existing");
  // JSON title is unchanged — PG did NOT silently overwrite.
  assert.equal(afterTask.title, "Already in JSON");
  // JSON status is unchanged — PG did NOT silently overwrite.
  assert.equal(afterTask.status, "pending");
  assert.equal(state.tasks.find((t) => t.id === "pg-fresh").source, "import-postgres");
});

test("runSync surfaces a warning when PG row is newer than JSON (still skips)", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "cat-sync-warn-pg-newer-"));
  const store = new TaskStore({ home });
  // JSON has an old task; PG has the same id with a newer timestamp.
  await store.addTask({
    id: "pg-drift",
    title: "Old version",
    prompt: "old",
    cwd: home,
    status: "pending",
  });
  // Backdate the JSON task so PG is strictly newer.
  const state = await store.readState();
  state.tasks[0].updatedAt = "2026-01-01T00:00:00.000Z";
  await fs.writeFile(path.join(home, "tasks.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const newerTs = "2026-10-02T00:00:00.000Z";
  const pgState = {
    ...emptyPgState(),
    tasks: [
      {
        id: "pg-drift",
        created_at: newerTs,
        updated_at: newerTs,
        payload: {
          id: "pg-drift",
          title: "PG newer copy",
          prompt: "would-clobber",
          cwd: "/tmp",
          status: "completed",
          priority: 0,
          attempts: 0,
          maxAttempts: 3,
          dueAt: newerTs,
          acceptanceChecks: [],
          auditLevel: "none",
          riskLevel: "medium",
          taskKind: "task",
          dependsOn: [],
          resourceKeys: [],
          rejectedApproaches: [],
          waitState: {},
          verification: {},
          createdAt: newerTs,
          updatedAt: newerTs,
          history: [],
        },
      },
    ],
  };

  const summary = await runSync({
    store,
    home,
    pgState,
    parsedArgs: DRY_RUN_ARGS,
    databaseUrl: "memory://test",
  });

  // Action is still skip — JSON canonical wins, we never overwrite.
  assert.equal(summary.totalAdds, 0);
  assert.equal(summary.totalSkips, 1);
  assert.equal(summary.planByCollection.tasks.skipCounts["skip-already-in-json"], 1);
  // But the operator can SEE the drift via the warnings array.
  assert.equal(summary.warnings.length, 1);
  assert.match(summary.warnings[0], /pg-drift/);
  assert.match(summary.warnings[0], /skipping per JSON-canonical rule/);

  // JSON title is still "Old version".
  const after = await store.readState();
  assert.equal(after.tasks[0].title, "Old version");
});

test("runSync is reentrant — second run reports zero new adds", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "cat-sync-reentrant-"));
  const store = new TaskStore({ home });
  const pgState = {
    ...emptyPgState(),
    tasks: [makePgTaskRow("pg-a"), makePgTaskRow("pg-b")],
  };

  // Apply run: both rows land in JSON + ledger.
  const first = await runSync({
    store,
    home,
    pgState,
    parsedArgs: APPLY_ARGS,
    databaseUrl: "memory://test",
  });
  assert.equal(first.totalAdds, 2);
  assert.equal(first.applied, true);

  // Same PG state, second run in dry-run mode:
  //   - pg-a / pg-b are in JSON → skip-already-in-json
  //   - pg-a / pg-b are in .synced-pg-to-json-ids.json → skip-already-synced
  //   (the synced-ledger check fires first)
  const second = await runSync({
    store,
    home,
    pgState,
    parsedArgs: DRY_RUN_ARGS,
    databaseUrl: "memory://test",
  });
  assert.equal(second.totalAdds, 0);
  assert.equal(second.totalSkips, 2);
  assert.equal(second.planByCollection.tasks.skipCounts["skip-already-synced"], 2);
  assert.equal(second.planByCollection.tasks.skipCounts["skip-already-in-json"], 0);

  // And a third run in apply mode is also a no-op: zero new mutations,
  // no second backup snapshot would be created if the path entered the
  // backup branch (it doesn't because totalAdds === 0).
  const third = await runSync({
    store,
    home,
    pgState,
    parsedArgs: APPLY_ARGS,
    databaseUrl: "memory://test",
  });
  assert.equal(third.totalAdds, 0);
  assert.equal(third.applied, undefined);
  assert.equal(third.backupPath, undefined);

  // Final state still has exactly the two tasks — no duplicates.
  const final = await store.readState();
  assert.equal(final.tasks.length, 2);
});

test("runSync --only-collections=tasks limits the scan to one collection", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "cat-sync-only-tasks-"));
  const store = new TaskStore({ home });
  const pgState = {
    ...emptyPgState(),
    tasks: [makePgTaskRow("pg-a")],
    completionSummaries: [makePgSummaryRow("cs-1")],
    auditReviews: [
      {
        id: "ar-1",
        task_id: "x",
        run_id: null,
        audit_level: "standard",
        verdict: "pending",
        reason: "reason",
        evidence_gaps: [],
        release_conditions: [],
        evidence_refs: [],
        created_at: new Date().toISOString(),
      },
    ],
  };

  const summary = await runSync({
    store,
    home,
    pgState,
    parsedArgs: { apply: false, confirmApply: false, onlyCollections: ["tasks"], dryRun: true },
    databaseUrl: "memory://test",
  });

  assert.deepEqual(summary.collections, ["tasks"]);
  assert.equal(summary.totalScanned, 1, "only `tasks` should be scanned");
  assert.equal(summary.totalAdds, 1);
  assert.deepEqual(summary.planByCollection.tasks.wouldAddIds, ["pg-a"]);
  // Other collections are NOT in the plan.
  assert.equal(summary.planByCollection.completionSummaries, undefined);
  assert.equal(summary.planByCollection.auditReviews, undefined);
});

test("runSync skips rows with missing id without throwing", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "cat-sync-missing-id-"));
  const store = new TaskStore({ home });
  const pgState = {
    ...emptyPgState(),
    tasks: [
      // Missing top-level `id` → skip-missing-id (the tool identifies PG rows
      // by the column id, not the payload.id).
      { id: null, payload: { title: "no-id", prompt: "x" }, created_at: "x", updated_at: "x" },
      { id: undefined, payload: { title: "also-no-id", prompt: "y" }, created_at: "x", updated_at: "x" },
      makePgTaskRow("pg-a"),
    ],
  };

  const summary = await runSync({
    store,
    home,
    pgState,
    parsedArgs: DRY_RUN_ARGS,
    databaseUrl: "memory://test",
  });

  assert.equal(summary.totalSkips, 2);
  assert.equal(summary.totalAdds, 1);
  assert.equal(summary.planByCollection.tasks.skipCounts["skip-missing-id"], 2);
  assert.deepEqual(summary.planByCollection.tasks.wouldAddIds, ["pg-a"]);
});