#!/usr/bin/env node
// Historical completed-task recheck for Axi Todo.
//
// M5 motivation: the canonical JSON store at $HOME/.axi-todo/tasks.json may
// contain tasks marked status:'completed' whose target cwd has since been
// retired (scratch worktree cleaned up after merge, or path renamed during
// partition reorg) or whose evidence chain is no longer reachable. Re-running
// the historical verifyCommand against the current filesystem is unreliable
// because many verifyCommands depended on scratch worktrees that no longer
// exist, and the original evidence (VERIFICATION.md / completion_summary.json)
// may not have been persisted next to the JSON store.
//
// This tool applies a non-destructive evidence triage per owner direction:
//   keep-completed   cwd still exists AND VERIFICATION.md present in cwd AND
//                    stored verification.status === 'passed'
//   cancelled        cwd no longer exists (target retired) — NOT a failure
//   failed           history contains 'failed' without subsequent completion
//   awaiting_audit   indeterminate
//
// Usage:
//   node bin/axi-todo-recheck-completed.mjs                  # dry-run (default)
//   node bin/axi-todo-recheck-completed.mjs --apply          # write decisions into tasks.json
//   node bin/axi-todo-recheck-completed.mjs --apply --only-decide=keep-completed,cancelled
//   AXI_TODO_HOME=/path node bin/axi-todo-recheck-completed.mjs --apply
//
// Exit codes:
//   0  success (zero or more tasks reclassified)
//   1  invalid arguments or store read failure
//   2  write failure during --apply
//
// --apply requires explicit owner confirmation; it overwrites the JSON store
// and bumps updatedAt on every affected task. A backup snapshot is written
// to <home>/.m1-snapshot/m5-audit/pre-apply-<ISO>.json before any mutation.

import fs from "node:fs/promises";
import path from "node:path";
import { defaultAxiTodoHome, nowIso } from "../lib/schema.mjs";

const APPLY = process.argv.includes("--apply");
const onlyDecideArg = process.argv.find((a) => a.startsWith("--only-decide="));
const ONLY_DECIDE = onlyDecideArg
  ? new Set(onlyDecideArg.slice("--only-decide=".length).split(",").map((s) => s.trim()).filter(Boolean))
  : null;

if (APPLY && !process.argv.includes("--confirm-apply")) {
  process.stderr.write(
    "axi-todo-recheck-completed: --apply requires --confirm-apply (owner-gated).\n" +
      "Refusing to mutate the JSON store without explicit double-flag.\n",
  );
  process.exit(1);
}

function decisionFor(task, cwdExists, hasOwnVerif) {
  const hasFailedHistory = Array.isArray(task.history)
    && task.history.some((h) => h && h.event === "failed");

  if (cwdExists && hasOwnVerif && task.verification?.status === "passed") {
    return { decision: "keep-completed", reason: "cwd present + in-cwd VERIFICATION.md present + stored verification.status=passed" };
  }
  if (!cwdExists) {
    return {
      decision: "cancelled",
      reason: "cwd path no longer exists: " + (task.cwd ?? "<none>") + " (target retired; not a task failure)",
    };
  }
  if (hasFailedHistory) {
    return { decision: "failed", reason: "history contains 'failed' event" };
  }
  return { decision: "awaiting_audit", reason: "cwd exists but no in-cwd VERIFICATION.md and no failure signal" };
}

async function pathExists(p) {
  if (!p) return false;
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function findVerifInCwd(cwd) {
  if (!cwd) return false;
  try {
    const entries = await fs.readdir(cwd, { withFileTypes: true });
    return entries.some((e) => e.isFile() && e.name === "VERIFICATION.md");
  } catch {
    return false;
  }
}

async function main() {
  const home = defaultAxiTodoHome({ AXI_TODO_HOME: process.env.AXI_TODO_HOME });
  const tasksPath = path.join(home, "tasks.json");
  const raw = await fs.readFile(tasksPath, "utf8");
  const store = JSON.parse(raw);

  const completed = (store.tasks ?? []).filter((t) => t.status === "completed");
  const results = [];
  for (const task of completed) {
    const cwdExists = await pathExists(task.cwd);
    const hasOwnVerif = cwdExists ? await findVerifInCwd(task.cwd) : false;
    const decision = decisionFor(task, cwdExists, hasOwnVerif);
    results.push({ id: task.id, title: task.title, cwd: task.cwd, ...decision });
  }

  const counts = results.reduce((acc, r) => {
    acc[r.decision] = (acc[r.decision] ?? 0) + 1;
    return acc;
  }, {});

  const filtered = ONLY_DECIDE
    ? results.filter((r) => ONLY_DECIDE.has(r.decision))
    : results;

  const report = {
    checkedAt: nowIso(),
    home,
    storeVersion: store.version,
    totalCompleted: completed.length,
    counts,
    filteredCount: filtered.length,
    decisions: filtered,
  };

  if (!APPLY) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }

  // --apply path
  const snapDir = path.join(home, ".m1-snapshot", "m5-audit");
  await fs.mkdir(snapDir, { recursive: true });
  const backupPath = path.join(snapDir, "pre-apply-" + nowIso().replace(/[:.]/g, "-") + ".json");
  await fs.writeFile(backupPath, JSON.stringify(store, null, 2));

  const decisionById = new Map(filtered.map((r) => [r.id, r]));
  let changed = 0;
  for (const task of store.tasks) {
    const d = decisionById.get(task.id);
    if (!d) continue;
    if (d.decision === "keep-completed") {
      // append audit note but do not change status
      task.history = Array.isArray(task.history) ? task.history : [];
      task.history.push({
        event: "m5_recheck_kept",
        at: nowIso(),
        actor: "axi-todo-recheck-completed",
        note: d.reason,
      });
      task.updatedAt = nowIso();
      changed += 1;
    } else if (d.decision === "cancelled" || d.decision === "failed" || d.decision === "awaiting_audit") {
      task.status = d.decision;
      task.history = Array.isArray(task.history) ? task.history : [];
      task.history.push({
        event: "m5_recheck_" + d.decision,
        at: nowIso(),
        actor: "axi-todo-recheck-completed",
        note: d.reason,
      });
      task.updatedAt = nowIso();
      changed += 1;
    }
  }

  await fs.writeFile(tasksPath, JSON.stringify(store, null, 2));
  process.stdout.write(
    JSON.stringify({ ...report, applied: true, backupPath, changed }, null, 2) + "\n",
  );
}

main().catch((err) => {
  process.stderr.write("axi-todo-recheck-completed: " + (err && err.stack ? err.stack : String(err)) + "\n");
  process.exit(2);
});
