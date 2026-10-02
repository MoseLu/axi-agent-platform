import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TaskStore } from "../lib/store.mjs";
import { runImport } from "../bin/axi-todo-import-postgres.mjs";

function makeFixtureRow(id, overrides = {}) {
  // Mirrors the PG `payload` jsonb shape the migrator would have written.
  // createTask() is forgiving about unknown keys, so we only need enough to
  // round-trip the title + status + a couple of distinctive fields.
  const now = new Date().toISOString();
  return {
    id,
    created_at: now,
    payload: {
      id,
      title: `PG row ${id}`,
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
      // overrides is treated as flat field overrides on `payload` itself —
      // callers that need to override `status` / `auditLevel` etc. pass them
      // at the top level (e.g. `makeFixtureRow("pg-b", { status: "completed" })`).
      ...overrides,
    },
  };
}

test("runImport writes PG rows into JSON with provenance fields", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-import-fresh-"));
  const store = new TaskStore({ home });
  const rows = [
    makeFixtureRow("pg-a"),
    makeFixtureRow("pg-b", { title: "PG row pg-b", prompt: "b prompt", status: "completed", auditLevel: "strict" }),
    makeFixtureRow("pg-c"),
  ];

  const summary = await runImport({ store, home, rows, dryRun: false, databaseUrl: "memory://test" });
  assert.equal(summary.toImport, 3);
  assert.equal(summary.importedNow, 3);
  assert.equal(summary.alreadyImported, 0);
  assert.equal(summary.alreadyInJson, 0);

  const state = await store.readState();
  assert.equal(state.tasks.length, 3);
  const titlesById = Object.fromEntries(state.tasks.map((t) => [t.id, t.title]));
  assert.equal(titlesById["pg-a"], "PG row pg-a");
  assert.equal(titlesById["pg-b"], "PG row pg-b");
  for (const task of state.tasks) {
    assert.equal(task.source, "import-postgres", `${task.id} missing source`);
    assert.ok(task.importedAt, `${task.id} missing importedAt`);
    assert.equal(task.taskDomain, "agent");
  }
  // Status round-trips; PG row with status=completed stays completed in JSON
  // (no gate fires — addTask just creates with the given status).
  const pgB = state.tasks.find((t) => t.id === "pg-b");
  assert.equal(pgB.status, "completed");
  assert.equal(pgB.auditLevel, "strict");

  // Imported-id ledger is written and contains all three ids.
  const ledger = JSON.parse(await fs.readFile(path.join(home, ".imported-pg-ids.json"), "utf8"));
  assert.equal(ledger.schemaVersion, 1);
  assert.deepEqual(ledger.ids.sort(), ["pg-a", "pg-b", "pg-c"]);
});

test("runImport is idempotent — second call skips already-imported ids", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-import-reentrant-"));
  const store = new TaskStore({ home });
  const rows = [makeFixtureRow("pg-x"), makeFixtureRow("pg-y")];

  const first = await runImport({ store, home, rows, dryRun: false, databaseUrl: "memory://test" });
  assert.equal(first.importedNow, 2);
  assert.equal(first.toImport, 2);

  // Same store + same rows + same imported-ids ledger → zero new imports.
  const second = await runImport({ store, home, rows, dryRun: false, databaseUrl: "memory://test" });
  assert.equal(second.toImport, 0);
  assert.equal(second.alreadyImported, 2);
  assert.equal(second.importedNow, undefined);
  const state = await store.readState();
  assert.equal(state.tasks.length, 2);
});

test("runImport skips ids that already exist in the JSON store", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-import-existing-"));
  const store = new TaskStore({ home });
  await store.addTask({ title: "Pre-existing", prompt: "preexisting", cwd: home });
  const beforeId = (await store.readState()).tasks[0].id;

  const rows = [
    // Same id as the pre-existing task → skip (existing JSON wins).
    makeFixtureRow(beforeId, { payload: { title: "would-clobber", prompt: "x", cwd: home } }),
    makeFixtureRow("pg-new"),
  ];

  const summary = await runImport({ store, home, rows, dryRun: false, databaseUrl: "memory://test" });
  assert.equal(summary.toImport, 1);
  assert.equal(summary.alreadyInJson, 1);
  assert.equal(summary.importedNow, 1);

  const state = await store.readState();
  assert.equal(state.tasks.length, 2);
  const pre = state.tasks.find((t) => t.id === beforeId);
  assert.equal(pre.title, "Pre-existing"); // not clobbered
  const imported = state.tasks.find((t) => t.id === "pg-new");
  assert.equal(imported.source, "import-postgres");
});

test("runImport dry-run reports counts without writing", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-import-dryrun-"));
  const store = new TaskStore({ home });
  const rows = [makeFixtureRow("pg-d1"), makeFixtureRow("pg-d2")];

  const summary = await runImport({ store, home, rows, dryRun: true, databaseUrl: "memory://test" });
  assert.equal(summary.dryRun, true);
  assert.equal(summary.toImport, 2);
  assert.equal(summary.importedNow, undefined);

  const state = await store.readState();
  assert.equal(state.tasks.length, 0);
  // Ledger is NOT created on dry-run either.
  await assert.rejects(fs.readFile(path.join(home, ".imported-pg-ids.json"), "utf8"), (error) => error.code === "ENOENT");
});

test("runImport survives a mid-run failure and marks only successful ids", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-import-midfail-"));
  const store = new TaskStore({ home });
  const rows = [makeFixtureRow("pg-ok"), makeFixtureRow("pg-bad"), makeFixtureRow("pg-after")];

  // Force addTask to fail only for `pg-bad`. Wrapping the real method keeps
  // the rest of the import flow honest (state writes, lock release, etc.).
  const originalAdd = store.addTask.bind(store);
  let badSeen = false;
  store.addTask = async (input, options) => {
    if (input.id === "pg-bad" && !badSeen) {
      badSeen = true;
      throw new Error("simulated PG row corruption");
    }
    return originalAdd(input, options);
  };

  await assert.rejects(runImport({ store, home, rows, dryRun: false, databaseUrl: "memory://test" }), /simulated/);
  // pg-ok landed before the failure; pg-after never ran; pg-bad is NOT in
  // the ledger (we only append after a successful addTask).
  const state = await store.readState();
  assert.ok(state.tasks.some((t) => t.id === "pg-ok"));
  assert.ok(!state.tasks.some((t) => t.id === "pg-bad"));
  assert.ok(!state.tasks.some((t) => t.id === "pg-after"));

  // Re-run with a healthy addTask: pg-bad and pg-after get imported; pg-ok
  // is skipped because it's already in the ledger.
  store.addTask = originalAdd;
  const recover = await runImport({ store, home, rows, dryRun: false, databaseUrl: "memory://test" });
  assert.equal(recover.toImport, 2); // pg-bad + pg-after
  const final = await store.readState();
  assert.equal(final.tasks.length, 3);
  for (const id of ["pg-ok", "pg-bad", "pg-after"]) {
    assert.ok(final.tasks.some((t) => t.id === id), `missing ${id} after recovery`);
  }
});
