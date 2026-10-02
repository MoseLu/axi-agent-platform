import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { DEFAULT_POSTGRES_DATABASE_URL, PostgresTaskStore } from "./postgres-store.mjs";
import { evaluateCompletion, describeGateDecision } from "./completion-gate.mjs";
import {
  appendHistory,
  canRetry,
  createEmptyState,
  createTask,
  defaultAxiTodoHome,
  isActionableTask,
  isDue,
  normalizePatch,
  normalizeMemoryCardType,
  normalizeState,
  nowIso,
  synchronizeTaskState,
  taskSort,
} from "./schema.mjs";
import { searchCollectionText } from "./memory-search.mjs";

const COMPLETION_STATUS = "completed";
const AWAITING_AUDIT_STATUS = "awaiting_audit";

const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 5000;

export class TaskStore {
  constructor({ home = defaultAxiTodoHome(), filePath } = {}) {
    this.home = path.resolve(home);
    this.filePath = path.resolve(filePath || path.join(this.home, "tasks.json"));
    this.lockPath = `${this.filePath}.lock`;
  }

  async readState() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      if (error?.code === "ENOENT") return createEmptyState();
      throw error;
    }
  }

  async listTasks({ status, taskDomain } = {}) {
    const state = await this.readState();
    return state.tasks
      .filter((task) => !status || task.status === status)
      .filter((task) => !taskDomain || task.taskDomain === taskDomain)
      .sort(taskSort);
  }

  async listReadyTasks({ limit = 50, now = nowIso() } = {}) {
    const state = await this.readState();
    return selectSchedulableTasks(state, { limit, now });
  }

  async scheduleTasks({ limit = 50, now = nowIso() } = {}) {
    const state = await this.readState();
    return {
      now,
      limit,
      tasks: selectSchedulableTasks(state, { limit, now }),
      blocked: explainBlockedTasks(state, { now }),
    };
  }

  async getTask(id) {
    const state = await this.readState();
    return state.tasks.find((task) => task.id === id) || null;
  }

  async addTask(input, options = {}) {
    return this.mutate((state) => {
      const task = createTask(input, options);
      state.tasks.push(task);
      return { state, result: task };
    });
  }

  async updateTask(id, patchInput, { note, event = "updated", now = nowIso() } = {}) {
    const patch = normalizePatch(patchInput);
    return this.mutate((state) => {
      const task = findTaskOrThrow(state, id);
      // Direct `status: "completed"` patches MUST clear the completion gate.
      // Personal todos are exempt (manual completion is allowed); for agent
      // tasks, a status patch that tries to bypass the runner is either a UI
      // mistake or a contract violation, so we route it through the same gate
      // completeTask uses. The patch is dropped (status stays at its prior
      // value, e.g. `awaiting_audit`) and the history records the gate hold.
      if (patch.status === COMPLETION_STATUS && task.taskDomain !== "personal") {
        const gate = evaluateCompletion(task, { verification: task.verification });
        if (gate.status === AWAITING_AUDIT_STATUS) {
          patch.status = AWAITING_AUDIT_STATUS;
          task.evidenceMissing = true;
          task.evidenceContractSeen = task.evidenceContract || task.evidenceContractSeen;
          task.error = describeGateDecision(gate, { task, result: {} }) || task.error;
          appendHistory(
            task,
            "audit_waiting",
            `Direct completion blocked by gate: ${gate.reason}`,
            { reason: gate.reason, source: "updateTask" },
            now,
            "system",
          );
        }
      }
      Object.assign(task, patch);
      synchronizeTaskState(task, { patch, now });
      task.updatedAt = now;
      appendHistory(task, event, note || "Task updated", { patch }, now, task.taskDomain === "personal" ? "user" : "system");
      return { state, result: task };
    });
  }

  async snoozeTask(id, { minutes = 15, now = nowIso() } = {}) {
    const task = await this.getTask(id);
    if (!task || task.taskDomain !== "personal") throw new Error(`task is not personal: ${id}`);
    if (task.lifecycleStatus !== "open") throw new Error(`cannot snooze closed personal task: ${id}`);
    const remindAt = new Date(Date.parse(now) + Math.max(1, Number(minutes) || 15) * 60_000).toISOString();
    return this.updateTask(id, {
      remindAt,
      reminderState: "snoozed",
    }, {
      event: "reminder_snoozed",
      note: `Reminder snoozed for ${minutes} minutes`,
      now,
    });
  }

  async completePersonalTask(id, { now = nowIso() } = {}) {
    const task = await this.getTask(id);
    if (!task || task.taskDomain !== "personal") throw new Error(`task is not personal: ${id}`);
    if (task.lifecycleStatus !== "open") throw new Error(`cannot complete closed personal task: ${id}`);
    return this.updateTask(id, { status: "completed", lifecycleStatus: "completed" }, {
      event: "completed",
      note: "Todo completed",
      now,
    });
  }

  async reopenPersonalTask(id, { now = nowIso() } = {}) {
    const task = await this.getTask(id);
    if (!task || task.taskDomain !== "personal") throw new Error(`task is not personal: ${id}`);
    return this.updateTask(id, { status: "pending", lifecycleStatus: "open" }, {
      event: "reopened",
      note: "Todo reopened",
      now,
    });
  }

  async getTaskActivity(id) {
    const task = await this.getTask(id);
    if (!task) throw new Error(`unknown task: ${id}`);
    return task.history || [];
  }

  async deleteTask(id, { now = nowIso() } = {}) {
    return this.mutate((state) => {
      const index = state.tasks.findIndex((candidate) => candidate.id === id);
      if (index === -1) throw new Error(`unknown task: ${id}`);
      const task = state.tasks[index];
      if (task.status === "running") {
        throw new Error(`cannot delete running task: ${id}`);
      }
      state.tasks.splice(index, 1);
      task.updatedAt = now;
      appendHistory(task, "deleted", "Task deleted", {}, now);
      return { state, result: task };
    });
  }

  async claimNextTask({ runnerId = process.pid, now = nowIso() } = {}) {
    return this.mutate((state) => {
      const task = selectSchedulableTasks(state, { limit: 1, now })[0];
      if (!task) return { state, result: null };
      task.status = "running";
      task.attempts = Number(task.attempts || 0) + 1;
      task.startedAt = now;
      task.updatedAt = now;
      task.error = undefined;
      appendHistory(task, "claimed", "Task claimed by runner", { runnerId }, now);
      return { state, result: task };
    });
  }

async completeTask(id, result, { now = nowIso() } = {}) {
    // A2 + M1.S2: evidence / claim-file / verification guardrails.
    // All completion-entry decisions flow through evaluateCompletion so JSON
    // and PG stores enforce the same transition gate. The runner hands us
    // `evidenceMissing`, `claimFiles`, and the captured `verification`; we
    // compute the gate decision first, then apply visible side-effects.
    const claimFiles = Array.isArray(result?.claimFiles) ? result.claimFiles : [];
    const claimFileMismatches = claimFiles.length > 0
      ? await findMissingClaimFiles(claimFiles, result?.cwd)
      : [];
    const evidenceContract = typeof result?.evidenceContract === "string"
      ? result.evidenceContract
      : undefined;
    const auditLevel = result?.auditLevel || "none";
    const evidenceMissing = Boolean(result?.evidenceMissing);
    const truncatedOutput = result?.truncated;
    const warnings = Array.isArray(result?.warnings) ? result.warnings.slice() : [];
    if (claimFileMismatches.length > 0) {
      warnings.push(`claimed-files-missing:${claimFileMismatches.length}`);
    }

    return this.mutate((state) => {
      const task = findTaskOrThrow(state, id);
      const gate = evaluateCompletion(task, result);
      const needsAudit = gate.status === AWAITING_AUDIT_STATUS;
      const finalStatus = gate.status;

      // Soft warning when the runner reports Evidence missing but the task
      // is below the audit threshold; surfaces as a visible summary line.
      if (evidenceMissing && evidenceContract && !needsAudit) {
        warnings.push("evidence-section-missing-in-last-message");
      }

      task.status = finalStatus;
      if (needsAudit) {
        // Mark the audit lane: a follow-up audit review will be appended
        // after this mutate commits (recordAuditReview acquires the same
        // file lock and cannot be nested inside the mutate).
        task.evidenceMissing = true;
        task.evidenceContractSeen = evidenceContract || task.evidenceContractSeen;
      } else {
        task.evidenceMissing = false;
        task.evidenceContractSeen = evidenceContract || task.evidenceContractSeen;
      }
      const baseSummary = result.summary || task.summary || "";
      const warningBlock = formatWarningBlock(warnings, claimFileMismatches, truncatedOutput);
      const gateBlock = needsAudit ? describeGateDecision(gate, { task, result }) : "";
      const composed = [baseSummary, warningBlock, gateBlock].filter(Boolean).join("\n\n");
      task.summary = composed;
      task.error = needsAudit ? "任务已完成,但未通过完工验收门" : undefined;
      task.completedAt = needsAudit ? undefined : now;
      task.updatedAt = now;
      task.lastRunId = result.runId || task.lastRunId;
      task.lastOutputPath = result.outputPath || task.lastOutputPath;
      if (result.verification) task.verification = result.verification;
      const historyData = compactRunResult(result);
      historyData.warnings = warnings;
      if (claimFileMismatches.length > 0) {
        historyData.claimedFileMismatches = claimFileMismatches;
      }
      if (needsAudit) historyData.gateReason = gate.reason;
      appendHistory(
        task,
        needsAudit ? "audit_waiting" : "completed",
        needsAudit
          ? `任务已完成,但未通过完工验收门: ${gate.reason}`
          : "Task completed",
        historyData,
        now,
      );
      if (!needsAudit && result.completionSummary) {
        state.completionSummaries.push(createCompletionSummaryRecord(task, result.completionSummary, now));
      }
      for (const card of normalizeMemoryCards(result.memoryCards, task, now)) {
        state.memoryCards.push(card);
      }
      return { state, result: { task, needsAudit, gate, evidenceContract } };
    }).then(async (mutateResult) => {
      if (!mutateResult?.needsAudit) return mutateResult.task;
      const gateReason = mutateResult.gate?.reason || "gate_failed";
      await this.appendRecord("auditReviews", {
        id: crypto.randomUUID(),
        taskId: id,
        runId: result.runId,
        auditLevel,
        verdict: "pending",
        reason: `Completion gate held task (${gateReason})`,
        evidenceGaps: gateReason === "evidence_section_missing"
          ? ["evidence-section-missing"]
          : gateReason === "verification_failed"
            ? ["verification-failed"]
            : gateReason === "verification_missing"
              ? ["verification-absent"]
              : ["gate-failed"],
        releaseConditions: gateReason === "evidence_section_missing"
          ? ["Provide a `## Evidence` section with `claim` and `files:` in the next run."]
          : gateReason === "verification_failed"
            ? ["Make the verifyCommand pass before retrying completion."]
            : ["Resolve the gate condition; verify and evidence must both be present and passing."],
        evidenceRefs: result?.outputPath ? [result.outputPath] : [],
        createdAt: now,
      });
      return mutateResult.task;
    });
  }

  async failTask(id, result, { now = nowIso(), retryDelayMs = 0 } = {}) {
    return this.mutate((state) => {
      const task = findTaskOrThrow(state, id);
      const retry = canRetry(task);
      task.status = retry ? "pending" : "failed";
      task.error = result.error || "Task failed";
      task.summary = result.summary || task.summary;
      task.updatedAt = now;
      task.lastRunId = result.runId || task.lastRunId;
      task.lastOutputPath = result.outputPath || task.lastOutputPath;
      if (retry && retryDelayMs > 0) {
        task.dueAt = new Date(Date.parse(now) + retryDelayMs).toISOString();
      }
      if (result.verification) task.verification = result.verification;
      appendHistory(
        task,
        retry ? "retry_scheduled" : "failed",
        retry ? "Task failed; retry scheduled" : "Task failed",
        compactRunResult(result),
        now,
      );
      if (result.failureAnalysis) {
        state.failureAnalyses.push(createFailureAnalysisRecord(task, result.failureAnalysis, now));
      }
      for (const card of normalizeMemoryCards(result.memoryCards, task, now)) {
        state.memoryCards.push(card);
      }
      return { state, result: task };
    });
  }

  async reconcileStaleRunning({ now = nowIso(), timeoutMs = 60 * 60 * 1000 } = {}) {
    return this.mutate((state) => {
      const nowMs = Date.parse(now);
      const changed = [];
      for (const task of state.tasks) {
        if (task.status !== "running" || !task.startedAt) continue;
        const ageMs = nowMs - Date.parse(task.startedAt);
        if (ageMs <= timeoutMs) continue;
        task.status = "pending";
        task.updatedAt = now;
        task.error = "Runner timed out before finishing the task.";
        appendHistory(task, "requeued_stale_running", "Stale running task returned to pending", { ageMs }, now);
        changed.push(task.id);
      }
      return { state, result: changed };
    });
  }

  async markVerificationResult(id, verification, { now = nowIso(), failureStatus = "pending" } = {}) {
    return this.mutate((state) => {
      const task = findTaskOrThrow(state, id);
      task.verification = verification;
      task.updatedAt = now;
      // M1.S2: re-run the completion gate using the new verification so the
      // verify-passes-can-complete-now shortcut doesn't bypass evidence
      // contracts. A verification that fails stays in failureStatus/failed
      // exactly like before; personal tasks are exempt (evaluateCompletion
      // short-circuits when taskDomain === "personal").
      const gate = evaluateCompletion(task, { verification, evidenceContract: task.evidenceContract, auditLevel: task.auditLevel, evidenceMissing: task.evidenceMissing });
      if (verification.status === "failed") {
        task.status = canRetry(task) ? failureStatus : "failed";
        task.error = "Verification failed after completion.";
      } else if (verification.status === "passed") {
        if (gate.status === AWAITING_AUDIT_STATUS && task.taskDomain !== "personal") {
          task.status = AWAITING_AUDIT_STATUS;
          task.evidenceMissing = true;
          task.error = describeGateDecision(gate, { task, result: { verification } }) || task.error;
        } else {
          task.status = COMPLETION_STATUS;
          task.error = undefined;
        }
      }
      appendHistory(task, "verification_checked", "Task verification checked", { verification, gateReason: gate.reason, gateStatus: gate.status }, now);
      return { state, result: task };
    });
  }

  async recordTaskRun(input = {}, { now = nowIso() } = {}) {
    const record = {
      id: input.id || input.runId || crypto.randomUUID(),
      runId: input.runId || input.id,
      taskId: input.taskId,
      status: input.status || "running",
      model: input.model,
      cwd: input.cwd,
      quota: input.quota,
      startedAt: input.startedAt || now,
      endedAt: input.endedAt,
      durationMs: input.durationMs,
      exitCode: input.exitCode,
      outputPath: input.outputPath,
      verification: input.verification,
      error: input.error,
      createdAt: now,
      updatedAt: now,
    };
    return this.mutate((state) => {
      const existing = state.taskRuns.find((item) => item.runId && item.runId === record.runId);
      if (existing) {
        Object.assign(existing, { ...record, id: existing.id, createdAt: existing.createdAt, updatedAt: now });
        return { state, result: existing };
      }
      state.taskRuns.push(record);
      return { state, result: record };
    });
  }

  async recordTaskEvent(input = {}, { now = nowIso() } = {}) {
    return this.appendRecord("taskEvents", {
      id: input.id || crypto.randomUUID(),
      taskId: input.taskId,
      runId: input.runId,
      eventType: input.eventType || input.type || "event",
      actor: input.actor || "axi-todo",
      message: input.message,
      payload: input.payload && typeof input.payload === "object" ? input.payload : {},
      createdAt: input.createdAt || now,
    });
  }

  async recordFailureAnalysis(input = {}, { now = nowIso() } = {}) {
    return this.appendRecord("failureAnalyses", {
      id: input.id || crypto.randomUUID(),
      taskId: input.taskId,
      runId: input.runId,
      rootCause: input.rootCause || input.root_cause || input.error || "unknown",
      trigger: input.trigger,
      failureStage: input.failureStage || input.failure_stage,
      recoveryAction: input.recoveryAction || input.recovery_action,
      avoidNextTime: input.avoidNextTime || input.avoid_next_time,
      retryable: Boolean(input.retryable),
      evidence: input.evidence && typeof input.evidence === "object" ? input.evidence : {},
      createdAt: input.createdAt || now,
    });
  }

  async recordAuditReview(input = {}, { now = nowIso() } = {}) {
    const record = await this.appendRecord("auditReviews", {
      id: input.id || crypto.randomUUID(),
      taskId: input.taskId,
      runId: input.runId,
      auditLevel: input.auditLevel || input.audit_level || "standard",
      verdict: input.verdict || "pending",
      reason: input.reason,
      evidenceGaps: normalizeStringArray(input.evidenceGaps || input.evidence_gaps),
      releaseConditions: normalizeStringArray(input.releaseConditions || input.release_conditions),
      evidenceRefs: normalizeStringArray(input.evidenceRefs || input.evidence_refs),
      createdAt: input.createdAt || now,
    });
    if (input.taskId && input.verdict && input.verdict !== "pass") {
      await this.updateTask(input.taskId, { status: "awaiting_audit" }, {
        event: "audit_waiting",
        note: input.reason || "Task is waiting for audit approval",
        now,
      });
    }
    return record;
  }

  async recordUserPreference(input = {}, { now = nowIso() } = {}) {
    return this.appendRecord("userPreferences", {
      id: input.id || crypto.randomUUID(),
      taskId: input.taskId,
      preference: input.preference,
      source: input.source || "task",
      confidence: clampNumber(input.confidence, 0, 1, 0.8),
      createdAt: input.createdAt || now,
    });
  }

  async recordCompletionSummary(input = {}, { now = nowIso() } = {}) {
    return this.appendRecord("completionSummaries", {
      id: input.id || crypto.randomUUID(),
      taskId: input.taskId,
      runId: input.runId,
      status: input.status || "completed",
      summary: input.summary,
      durationMs: input.durationMs,
      verification: input.verification,
      evidenceRefs: normalizeStringArray(input.evidenceRefs || input.evidence_refs),
      auditVerdict: input.auditVerdict || input.audit_verdict,
      nextTimeNotes: input.nextTimeNotes || input.next_time_notes,
      createdAt: input.createdAt || now,
    });
  }

  async recordMemoryCard(input = {}, { now = nowIso() } = {}) {
    return this.appendRecord("memoryCards", {
      id: input.id || crypto.randomUUID(),
      taskId: input.taskId,
      runId: input.runId,
      type: normalizeMemoryCardType(input.type),
      title: input.title,
      content: input.content,
      concepts: normalizeStringArray(input.concepts),
      files: normalizeStringArray(input.files),
      syncStatus: input.syncStatus || "pending",
      syncedAt: input.syncedAt,
      syncError: input.syncError,
      createdAt: input.createdAt || now,
      updatedAt: input.updatedAt || now,
    });
  }

  async listMemoryCards({ type, syncStatus, limit = 50 } = {}) {
    const state = await this.readState();
    return state.memoryCards
      .filter((card) => !type || card.type === type)
      .filter((card) => !syncStatus || card.syncStatus === syncStatus)
      .slice(-limit);
  }

  async searchPlanningMemory({ query = "", limit = 20 } = {}) {
    const state = await this.readState();
    const needle = String(query || "");
    // M6: spread the record FIRST and then assign the collection marker last,
    // so the per-record `source` / `importedAt` provenance fields (added in M6
    // for completion_summaries / failure_analyses / memory_cards) cannot
    // shadow the collection-name marker that `searchCollectionText` keys on.
    // Previously the marker led with the spread, so a record with
    // `source: "native"` (or `"import-postgres"`) would overwrite the
    // collection name and `searchCollectionText` would return false for every
    // row — silently breaking searchPlanningMemory.
    const records = [
      ...state.planningRecords.map((item) => ({ ...item, source: "planning_records" })),
      ...state.failureAnalyses.map((item) => ({ ...item, source: "failure_analyses" })),
      ...state.completionSummaries.map((item) => ({ ...item, source: "completion_summaries" })),
      ...state.memoryCards.map((item) => ({ ...item, source: "memory_cards" })),
    ];
    return records.filter((item) => searchCollectionText(item, item.source, needle)).slice(-limit);
  }

  async appendRecord(collection, record) {
    return this.mutate((state) => {
      if (!Array.isArray(state[collection])) state[collection] = [];
      state[collection].push(record);
      return { state, result: record };
    });
  }

  async mutate(mutator) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    return withFileLock(this.lockPath, async () => {
      const state = await this.readState();
      const { state: nextState, result } = await mutator(state);
      await writeJsonAtomic(this.filePath, normalizeState(nextState));
      return result;
    });
  }
}

export function createStoreFromEnv(env = process.env) {
  // JSON is the canonical cross-surface store: the Swift desktop bridge reads
  // tasks.json directly. PostgreSQL remains available only when explicitly
  // selected, or through the explicit `auto` mode.
  const mode = String(env.AXI_TODO_STORE || "json").toLowerCase();
  if (mode === "postgres" || (mode === "auto" && (env.DATABASE_URL || env.AXI_TODO_DATABASE_URL))) {
    return new PostgresTaskStore({ databaseUrl: env.DATABASE_URL || env.AXI_TODO_DATABASE_URL || DEFAULT_POSTGRES_DATABASE_URL });
  }
  return new TaskStore({ home: defaultAxiTodoHome(env) });
}

// M4: dual-store startup warning. When both `~/.axi-todo/tasks.json` and the
// PG `axi_todo.tasks` table are non-empty, the operator may be about to
// silently write to one store while reading from the other. Long-running
// entry points (CLI bin, daemon, MCP server) call this right after picking a
// store; one-shot scripts can skip it.
//
// M2 unconditionally probed both stores on every boot. M4 gates the other-side
// probe behind AXI_TODO_DUAL_PROBE=1 — by default, when the caller has already
// declared a chosen side via AXI_TODO_STORE (or via the `auto` resolution
// picking one store), we trust that decision and skip the cross-store probe.
// This removes a PG connect on every JSON-only boot and a JSON file read on
// every PG-only boot. Set AXI_TODO_DUAL_PROBE=1 to force the M2 behavior
// (probe both sides) for debugging dual-store divergence.
export async function warnIfDualPopulated({
  store,
  env = process.env,
  stderr = process.stderr,
  log = (...args) => stderr.write(`${args.join(" ")}\n`),
  pgStoreFactory,
} = {}) {
  if (!store) return { warned: false, reason: "no-store" };
  const chosen = store instanceof PostgresTaskStore ? "postgres" : "json";
  // M4: probe gating. Skip the cross-store probe unless the operator opts in
  // via AXI_TODO_DUAL_PROBE=1. The caller has already declared a chosen side
  // (via AXI_TODO_STORE or via `auto` resolution), so by default we trust
  // that decision and avoid the cross-store IO. env is the resolved object
  // passed by the caller — defaults to process.env in production.
  const forceProbe = env && String(env.AXI_TODO_DUAL_PROBE || "") === "1";
  if (!forceProbe) {
    return { warned: false, chosen, reason: "probe-skipped" };
  }
  try {
    const otherKind = chosen === "postgres" ? "json" : "postgres";
    let otherPopulated = false;
    let otherCount = 0;
    let otherError = null;
    try {
      if (otherKind === "json") {
        const probe = new TaskStore({ home: defaultAxiTodoHome(env) });
        const state = await probe.readState();
        otherCount = state.tasks.length;
        otherPopulated = otherCount > 0;
      } else {
        const databaseUrl = env.DATABASE_URL || env.AXI_TODO_DATABASE_URL;
        if (!databaseUrl) {
          otherError = "DATABASE_URL not set";
        } else {
          // `pgStoreFactory` lets tests inject a fake PostgresTaskStore; in
          // production the default wires up a real one against the URL.
          const probe = pgStoreFactory ? pgStoreFactory() : new PostgresTaskStore({ databaseUrl });
          const state = await probe.readState();
          otherCount = state.tasks.length;
          otherPopulated = otherCount > 0;
        }
      }
    } catch (error) {
      otherError = error?.code === "ENOENT" ? "missing" : (error?.message || String(error));
    }
    if (!otherPopulated) {
      return { warned: false, chosen, otherKind, otherCount, otherError };
    }
    const message = `axi-todo: detected populated JSON + PG stores; using ${chosen}. ` +
      `Run bin/axi-todo-import-postgres.mjs to consolidate ` +
      `(other=${otherKind} tasks=${otherCount}${otherError ? ` probe_error=${otherError}` : ""}).`;
    log(message);
    return { warned: true, chosen, otherKind, otherCount, otherError, message };
  } catch (error) {
    // The warning must never break startup; swallow everything.
    return { warned: false, reason: "probe-failed", error: error?.message || String(error) };
  }
}

async function withFileLock(lockPath, fn) {
  const started = Date.now();
  let handle;
  while (!handle) {
    try {
      await fs.mkdir(path.dirname(lockPath), { recursive: true });
      handle = await fs.open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: nowIso() }));
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (Date.now() - started > LOCK_TIMEOUT_MS) {
        throw new Error(`timed out waiting for store lock: ${lockPath}`);
      }
      await delay(LOCK_RETRY_MS);
    }
  }
  try {
    return await fn();
  } finally {
    await handle.close().catch(() => {});
    await fs.unlink(lockPath).catch(() => {});
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, filePath);
}

/**
 * A2 helper: stat each path the model claimed to have changed. Anything
 * missing is returned in the order it was claimed. `cwd` is the task's
 * working directory; relative paths are resolved against it. We do not
 * fail the call if a single stat errors — we just record the path as
 * missing so the caller can warn. Returns [] for empty input.
 */
async function findMissingClaimFiles(claimFiles, cwd) {
  if (!Array.isArray(claimFiles) || claimFiles.length === 0) return [];
  const base = cwd ? path.resolve(cwd) : process.cwd();
  const missing = [];
  for (const raw of claimFiles) {
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const candidate = path.isAbsolute(raw) ? raw : path.resolve(base, raw);
    try {
      await fs.stat(candidate);
    } catch (error) {
      if (error?.code === "ENOENT") missing.push(raw);
      else missing.push(`${raw} (stat-error: ${error?.code || "unknown"})`);
    }
  }
  return missing;
}

/**
 * A2 + A4b helper: turn the assorted warning signals we have collected
 * (model-claim mismatches, runProcess truncation, missing evidence) into
 * a stable, machine-parseable block we can append to the task summary.
 * Returns "" when there is nothing to report.
 */
function formatWarningBlock(warnings = [], claimFileMismatches = [], truncated) {
  const lines = [];
  for (const warning of warnings) {
    if (typeof warning === "string" && warning) lines.push(`- ${warning}`);
  }
  for (const mismatch of claimFileMismatches) {
    lines.push(`- claimed-file-not-found: ${mismatch}`);
  }
  if (truncated && typeof truncated === "object") {
    for (const stream of ["stdout", "stderr"]) {
      if (truncated[stream]) {
        const bytes = truncated.droppedBytes?.[stream] ?? 0;
        lines.push(`- runner-${stream}-truncated-dropped-${bytes}b`);
      }
    }
  }
  return lines.length > 0 ? ["⚠️ axi-todo warnings:", ...lines].join("\n") : "";
}

function appendSummaryWarning(base, warningBlock) {
  if (!warningBlock) return base;
  if (!base) return warningBlock;
  return `${base.replace(/\s*$/, "")}\n\n${warningBlock}`;
}

function findTaskOrThrow(state, id) {
  const task = state.tasks.find((candidate) => candidate.id === id);
  if (!task) throw new Error(`unknown task: ${id}`);
  return task;
}

function compactRunResult(result = {}) {
  return {
    success: Boolean(result.success),
    runId: result.runId,
    outputPath: result.outputPath,
    exitCode: result.exitCode,
    error: result.error,
    verification: result.verification,
  };
}

function createCompletionSummaryRecord(task, input = {}, now) {
  return {
    id: input.id || crypto.randomUUID(),
    taskId: task.id,
    runId: input.runId || task.lastRunId,
    status: input.status || task.status,
    summary: input.summary || task.summary,
    durationMs: input.durationMs,
    verification: input.verification || task.verification,
    evidenceRefs: normalizeStringArray(input.evidenceRefs),
    auditVerdict: input.auditVerdict,
    nextTimeNotes: input.nextTimeNotes,
    createdAt: input.createdAt || now,
    // M6 provenance — see createTask in lib/schema.mjs for the matching
    // shape. JSON-side completion summaries inherit source / importedAt
    // from the parent task so an imported task keeps its provenance trail
    // intact across all child records.
    source: input.source || task.source || "native",
    importedAt: input.importedAt || task.importedAt || null,
  };
}

function createFailureAnalysisRecord(task, input = {}, now) {
  return {
    id: input.id || crypto.randomUUID(),
    taskId: task.id,
    runId: input.runId || task.lastRunId,
    rootCause: input.rootCause || task.error || "unknown",
    trigger: input.trigger,
    failureStage: input.failureStage,
    recoveryAction: input.recoveryAction,
    avoidNextTime: input.avoidNextTime,
    retryable: Boolean(input.retryable),
    evidence: input.evidence && typeof input.evidence === "object" ? input.evidence : {},
    createdAt: input.createdAt || now,
    // M6 provenance — see createCompletionSummaryRecord above. Failure
    // analyses inherit from the parent task so reconcilers can still tell
    // "this failure was reported by an imported task" from native rows.
    source: input.source || task.source || "native",
    importedAt: input.importedAt || task.importedAt || null,
  };
}

function normalizeMemoryCards(cards, task, now) {
  const raw = Array.isArray(cards) ? cards : cards ? [cards] : [];
  return raw.map((card) => ({
    id: card.id || crypto.randomUUID(),
    taskId: card.taskId || task.id,
    runId: card.runId || task.lastRunId,
    type: normalizeMemoryCardType(card.type),
    title: card.title,
    content: card.content,
    concepts: normalizeStringArray(card.concepts),
    files: normalizeStringArray(card.files),
    syncStatus: card.syncStatus || "pending",
    syncedAt: card.syncedAt,
    syncError: card.syncError,
    createdAt: card.createdAt || now,
    updatedAt: card.updatedAt || now,
    // M6 provenance — see createCompletionSummaryRecord. Memory cards
    // inherit from the parent task so an imported task's memory cards
    // stay traceable to the import run across the pending → synced
    // re-upsert cycle.
    source: card.source || task.source || "native",
    importedAt: card.importedAt || task.importedAt || null,
  }));
}

function normalizeStringArray(value) {
  if (value === null || value === undefined) return [];
  const raw = Array.isArray(value) ? value : String(value).split(",");
  return Array.from(new Set(raw.map((item) => String(item || "").trim()).filter(Boolean)));
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function selectSchedulableTasks(state, { limit, now }) {
  const runningKeys = new Set(state.tasks
    .filter((task) => task.status === "running")
    .flatMap(effectiveResourceKeys));
  const runningGroups = countRunningGroups(state);
  const selectedKeys = new Set();
  const selectedGroups = new Map();
  const completedIds = completedTaskIds(state);
  const selected = [];
  for (const task of state.tasks
    .filter((candidate) => isReadyCandidate(candidate, now, completedIds))
    .sort(taskSort)) {
    const keys = effectiveResourceKeys(task);
    if (keys.some((key) => runningKeys.has(key) || selectedKeys.has(key))) continue;
    if (exceedsParallelGroupLimit(task, runningGroups, selectedGroups)) continue;
    selected.push(task);
    for (const key of keys) selectedKeys.add(key);
    addParallelGroup(selectedGroups, task);
    if (selected.length >= limit) break;
  }
  return selected;
}

function explainBlockedTasks(state, { now }) {
  const completedIds = completedTaskIds(state);
  const runningKeys = new Set(state.tasks
    .filter((task) => task.status === "running")
    .flatMap(effectiveResourceKeys));
  const runningGroups = countRunningGroups(state);
  return state.tasks
    .filter((task) => task.status === "pending")
    .map((task) => {
      const reasons = [];
      if (!isDue(task, now)) reasons.push("not_due");
      if (!isActionableTask(task)) reasons.push("missing_prompt");
      const missing = task.dependsOn.filter((id) => !completedIds.has(id));
      if (missing.length) reasons.push(`waiting_on:${missing.join(",")}`);
      const conflicts = effectiveResourceKeys(task).filter((key) => runningKeys.has(key));
      if (conflicts.length) reasons.push(`resource_locked:${conflicts.join(",")}`);
      if (exceedsParallelGroupLimit(task, runningGroups, new Map())) reasons.push(`parallel_group_limited:${effectiveParallelGroup(task)}`);
      return reasons.length ? { id: task.id, title: task.title, reasons } : null;
    })
    .filter(Boolean);
}

function isReadyCandidate(task, now, completedIds) {
  return task.status === "pending"
    && isDue(task, now)
    && isActionableTask(task)
    && task.dependsOn.every((id) => completedIds.has(id));
}

function completedTaskIds(state) {
  return new Set(state.tasks
    .filter((task) => task.status === "completed")
    .map((task) => task.id));
}

function effectiveResourceKeys(task) {
  const keys = task.resourceKeys.length ? task.resourceKeys : [task.cwd];
  if (!task.worktreePath) return keys;
  return Array.from(new Set([...keys, `worktree:${task.worktreePath}`]));
}

function countRunningGroups(state) {
  const counts = new Map();
  for (const task of state.tasks) {
    if (task.status === "running") addParallelGroup(counts, task);
  }
  return counts;
}

function addParallelGroup(counts, task) {
  const group = effectiveParallelGroup(task);
  if (!group) return;
  counts.set(group, (counts.get(group) || 0) + 1);
}

function effectiveParallelGroup(task) {
  return task.parallelGroup || task.agentCategory || task.agentRole || undefined;
}

function exceedsParallelGroupLimit(task, runningGroups, selectedGroups) {
  const group = effectiveParallelGroup(task);
  if (!group || !task.maxParallelGroup) return false;
  const current = (runningGroups.get(group) || 0) + (selectedGroups.get(group) || 0);
  return current >= task.maxParallelGroup;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
