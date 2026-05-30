import { executeTaskWithCodex, runVerificationCommand } from "./codex-runner.mjs";
import { createStoreFromEnv } from "./store.mjs";
import { nowIso } from "./schema.mjs";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_RUNNING_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_COMPLETED_RECHECK_MS = 24 * 60 * 60 * 1000;

export async function runOnce({
  store = createStoreFromEnv(),
  executor = executeTaskWithCodex,
  executorOptions = {},
  now = nowIso(),
  runningTimeoutMs = DEFAULT_RUNNING_TIMEOUT_MS,
  completedRecheckMs = DEFAULT_COMPLETED_RECHECK_MS,
  retryDelayMs = 60 * 1000,
} = {}) {
  const stale = await store.reconcileStaleRunning({ now, timeoutMs: runningTimeoutMs });
  const verification = await recheckCompletedTasks(store, { now, completedRecheckMs });
  const task = await store.claimNextTask({ now });
  if (!task) {
    return { claimed: null, stale, verification };
  }
  const result = await executor(task, executorOptions);
  const updated = result.success
    ? await store.completeTask(task.id, result, { now: nowIso() })
    : await store.failTask(task.id, result, { now: nowIso(), retryDelayMs });
  return {
    claimed: task.id,
    status: updated.status,
    stale,
    verification,
    result,
  };
}

export async function recheckCompletedTasks(store, { now = nowIso(), completedRecheckMs = DEFAULT_COMPLETED_RECHECK_MS } = {}) {
  const tasks = await store.listTasks({ status: "completed" });
  const checked = [];
  for (const task of tasks) {
    if (!task.verifyCommand) continue;
    if (!shouldRecheck(task, now, completedRecheckMs)) continue;
    const verification = await runVerificationCommand(task);
    await store.markVerificationResult(task.id, verification, { now });
    checked.push({ taskId: task.id, status: verification.status });
  }
  return checked;
}

export async function runDaemon({ store = createStoreFromEnv(), intervalMs = DEFAULT_INTERVAL_MS, once = false } = {}) {
  async function tick() {
    const result = await runOnce({ store });
    process.stdout.write(`${JSON.stringify({ at: nowIso(), ...result })}\n`);
  }
  await tick();
  if (once) return;
  const timer = setInterval(() => {
    tick().catch((error) => {
      process.stderr.write(`[axi-todo] daemon tick failed: ${error?.stack || error}\n`);
    });
  }, intervalMs);
  await new Promise(() => {});
}

function shouldRecheck(task, now, completedRecheckMs) {
  const checkedAt = task.verification?.checkedAt;
  if (!checkedAt) return true;
  return Date.parse(now) - Date.parse(checkedAt) >= completedRecheckMs;
}
