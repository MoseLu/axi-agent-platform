import pg from "pg";
import {
  appendHistory,
  canRetry,
  createEmptyState,
  createTask,
  isActionableTask,
  isDue,
  normalizeMemoryCardType,
  normalizeExistingTask,
  normalizePatch,
  normalizeState,
  nowIso,
  synchronizeTaskState,
  taskSort,
} from "./schema.mjs";
import crypto from "node:crypto";

const { Pool } = pg;
export const DEFAULT_POSTGRES_DATABASE_URL = "postgresql:///axi_todo";

export class PostgresTaskStore {
  constructor({ databaseUrl = process.env.DATABASE_URL || process.env.AXI_TODO_DATABASE_URL || DEFAULT_POSTGRES_DATABASE_URL, pool } = {}) {
    if (!pool && !databaseUrl) throw new Error("DATABASE_URL is required for PostgresTaskStore");
    this.pool = pool || new Pool({ connectionString: databaseUrl });
  }

  async readState() {
    const [
      tasks,
      taskCharters,
      planningRecords,
      taskRuns,
      taskEvents,
      failureAnalyses,
      auditReviews,
      userPreferences,
      completionSummaries,
      memoryCards,
    ] = await Promise.all([
      this.queryTasks("select payload from tasks order by priority desc, created_at asc"),
      this.queryRows("select * from task_charters order by created_at asc"),
      this.queryRows("select * from planning_records order by created_at asc"),
      this.queryRows("select * from task_runs order by created_at asc"),
      this.queryRows("select * from task_events order by created_at asc"),
      this.queryRows("select * from failure_analyses order by created_at asc"),
      this.queryRows("select * from audit_reviews order by created_at asc"),
      this.queryRows("select * from user_preferences order by created_at asc"),
      this.queryRows("select * from completion_summaries order by created_at asc"),
      this.queryRows("select * from memory_cards order by created_at asc"),
    ]);
    return normalizeState({
      ...createEmptyState(),
      tasks,
      taskCharters,
      planningRecords,
      taskRuns,
      taskEvents,
      failureAnalyses,
      auditReviews,
      userPreferences,
      completionSummaries,
      memoryCards,
    });
  }

  async listTasks({ status, taskDomain } = {}) {
    const values = [];
    const where = status ? "where status = $1" : "";
    if (status) values.push(status);
    const result = await this.pool.query(
      `select payload from tasks ${where} order by priority desc, created_at asc`,
      values,
    );
    return result.rows
      .map((row) => normalizeDbTask(row.payload))
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
    const result = await this.pool.query("select payload from tasks where id = $1", [id]);
    return result.rows[0] ? normalizeDbTask(result.rows[0].payload) : null;
  }

  async addTask(input, options = {}) {
    const task = createTask(input, options);
    await this.upsertTask(task);
    return task;
  }

  async updateTask(id, patchInput, { note, event = "updated", now = nowIso() } = {}) {
    return this.withClient(async (client) => {
      const task = await this.getTaskForUpdate(client, id);
      const patch = normalizePatch(patchInput);
      Object.assign(task, patch);
      synchronizeTaskState(task, { patch, now });
      task.updatedAt = now;
      appendHistory(task, event, note || "Task updated", { patch }, now, task.taskDomain === "personal" ? "user" : "system");
      await this.upsertTask(task, client);
      return task;
    });
  }

  async snoozeTask(id, { minutes = 15, now = nowIso() } = {}) {
    const task = await this.getTask(id);
    if (!task || task.taskDomain !== "personal") throw new Error(`task is not personal: ${id}`);
    if (task.lifecycleStatus !== "open") throw new Error(`cannot snooze closed personal task: ${id}`);
    const remindAt = new Date(Date.parse(now) + Math.max(1, Number(minutes) || 15) * 60_000).toISOString();
    return this.updateTask(id, { remindAt, reminderState: "snoozed" }, {
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

  async deleteTask(id) {
    return this.withClient(async (client) => {
      const task = await this.getTaskForUpdate(client, id);
      if (task.status === "running") throw new Error(`cannot delete running task: ${id}`);
      await client.query("delete from tasks where id = $1", [id]);
      appendHistory(task, "deleted", "Task deleted", {}, nowIso());
      return task;
    });
  }

  async claimNextTask({ runnerId = process.pid, now = nowIso() } = {}) {
    return this.withClient(async (client) => {
      const result = await client.query("select payload from tasks order by priority desc, created_at asc for update");
      const state = normalizeState({ ...createEmptyState(), tasks: result.rows.map((row) => normalizeDbTask(row.payload)) });
      const task = selectSchedulableTasks(state, { limit: 1, now })[0];
      if (!task) return null;
      task.status = "running";
      task.attempts = Number(task.attempts || 0) + 1;
      task.startedAt = now;
      task.updatedAt = now;
      task.error = undefined;
      appendHistory(task, "claimed", "Task claimed by runner", { runnerId }, now);
      await this.upsertTask(task, client);
      return task;
    });
  }

  async completeTask(id, result, { now = nowIso() } = {}) {
    return this.withClient(async (client) => {
      const task = await this.getTaskForUpdate(client, id);
      task.status = "completed";
      task.summary = result.summary || task.summary;
      task.error = undefined;
      task.completedAt = now;
      task.updatedAt = now;
      task.lastRunId = result.runId || task.lastRunId;
      task.lastOutputPath = result.outputPath || task.lastOutputPath;
      if (result.verification) task.verification = result.verification;
      appendHistory(task, "completed", "Task completed", compactRunResult(result), now);
      await this.upsertTask(task, client);
      if (result.completionSummary) await this.insertCompletionSummary(task, result.completionSummary, client, now);
      for (const card of normalizeMemoryCards(result.memoryCards, task, now)) await this.insertMemoryCard(card, client);
      return task;
    });
  }

  async failTask(id, result, { now = nowIso(), retryDelayMs = 0 } = {}) {
    return this.withClient(async (client) => {
      const task = await this.getTaskForUpdate(client, id);
      const retry = canRetry(task);
      task.status = retry ? "pending" : "failed";
      task.error = result.error || "Task failed";
      task.summary = result.summary || task.summary;
      task.updatedAt = now;
      task.lastRunId = result.runId || task.lastRunId;
      task.lastOutputPath = result.outputPath || task.lastOutputPath;
      if (retry && retryDelayMs > 0) task.dueAt = new Date(Date.parse(now) + retryDelayMs).toISOString();
      if (result.verification) task.verification = result.verification;
      appendHistory(task, retry ? "retry_scheduled" : "failed", retry ? "Task failed; retry scheduled" : "Task failed", compactRunResult(result), now);
      await this.upsertTask(task, client);
      if (result.failureAnalysis) await this.insertFailureAnalysis(task, result.failureAnalysis, client, now);
      for (const card of normalizeMemoryCards(result.memoryCards, task, now)) await this.insertMemoryCard(card, client);
      return task;
    });
  }

  async reconcileStaleRunning({ now = nowIso(), timeoutMs = 60 * 60 * 1000 } = {}) {
    return this.withClient(async (client) => {
      const result = await client.query("select payload from tasks where status = 'running' for update");
      const nowMs = Date.parse(now);
      const changed = [];
      for (const row of result.rows) {
        const task = normalizeDbTask(row.payload);
        if (!task.startedAt) continue;
        const ageMs = nowMs - Date.parse(task.startedAt);
        if (ageMs <= timeoutMs) continue;
        task.status = "pending";
        task.updatedAt = now;
        task.error = "Runner timed out before finishing the task.";
        appendHistory(task, "requeued_stale_running", "Stale running task returned to pending", { ageMs }, now);
        await this.upsertTask(task, client);
        changed.push(task.id);
      }
      return changed;
    });
  }

  async markVerificationResult(id, verification, { now = nowIso(), failureStatus = "pending" } = {}) {
    return this.withClient(async (client) => {
      const task = await this.getTaskForUpdate(client, id);
      task.verification = verification;
      task.updatedAt = now;
      if (verification.status === "failed") {
        task.status = canRetry(task) ? failureStatus : "failed";
        task.error = "Verification failed after completion.";
      } else if (verification.status === "passed") {
        task.status = "completed";
        task.error = undefined;
      }
      appendHistory(task, "verification_checked", "Task verification checked", verification, now);
      await this.upsertTask(task, client);
      return task;
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
      quota: input.quota || {},
      startedAt: input.startedAt || now,
      endedAt: input.endedAt,
      durationMs: input.durationMs,
      exitCode: input.exitCode,
      outputPath: input.outputPath,
      verification: input.verification || {},
      error: input.error,
      createdAt: now,
      updatedAt: now,
    };
    await this.pool.query(
      `insert into task_runs (id, run_id, task_id, status, model, cwd, quota, started_at, ended_at, duration_ms, exit_code, output_path, verification, error, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       on conflict (id) do update set status = excluded.status, ended_at = excluded.ended_at, duration_ms = excluded.duration_ms, exit_code = excluded.exit_code, output_path = excluded.output_path, verification = excluded.verification, error = excluded.error, updated_at = excluded.updated_at`,
      [record.id, record.runId, record.taskId, record.status, record.model, record.cwd, jsonb(record.quota), record.startedAt, record.endedAt, record.durationMs, record.exitCode, record.outputPath, jsonb(record.verification), record.error, record.createdAt, record.updatedAt],
    );
    return record;
  }

  async recordTaskEvent(input = {}, { now = nowIso() } = {}) {
    const record = {
      id: input.id || crypto.randomUUID(),
      taskId: input.taskId,
      runId: input.runId,
      eventType: input.eventType || input.type || "event",
      actor: input.actor || "axi-todo",
      message: input.message,
      payload: input.payload && typeof input.payload === "object" ? input.payload : {},
      createdAt: input.createdAt || now,
    };
    await this.pool.query(
      "insert into task_events (id, task_id, run_id, event_type, actor, message, payload, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8)",
      [record.id, record.taskId, record.runId, record.eventType, record.actor, record.message, jsonb(record.payload), record.createdAt],
    );
    return record;
  }

  async recordFailureAnalysis(input = {}, { now = nowIso() } = {}) {
    const task = input.taskId ? await this.getTask(input.taskId) : { id: input.taskId };
    const record = createFailureAnalysisRecord(task || { id: input.taskId }, input, now);
    await this.insertFailureAnalysis(task || { id: input.taskId }, record);
    return record;
  }

  async recordAuditReview(input = {}, { now = nowIso() } = {}) {
    const record = {
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
    };
    await this.pool.query(
      "insert into audit_reviews (id, task_id, run_id, audit_level, verdict, reason, evidence_gaps, release_conditions, evidence_refs, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [record.id, record.taskId, record.runId, record.auditLevel, record.verdict, record.reason, jsonb(record.evidenceGaps), jsonb(record.releaseConditions), jsonb(record.evidenceRefs), record.createdAt],
    );
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
    const record = {
      id: input.id || crypto.randomUUID(),
      taskId: input.taskId,
      preference: input.preference,
      source: input.source || "task",
      confidence: clampNumber(input.confidence, 0, 1, 0.8),
      createdAt: input.createdAt || now,
    };
    await this.pool.query(
      "insert into user_preferences (id, task_id, preference, source, confidence, created_at) values ($1,$2,$3,$4,$5,$6)",
      [record.id, record.taskId, record.preference, record.source, record.confidence, record.createdAt],
    );
    return record;
  }

  async recordCompletionSummary(input = {}, { now = nowIso() } = {}) {
    const record = {
      id: input.id || crypto.randomUUID(),
      taskId: input.taskId,
      runId: input.runId,
      status: input.status || "completed",
      summary: input.summary,
      durationMs: input.durationMs,
      verification: input.verification || {},
      evidenceRefs: normalizeStringArray(input.evidenceRefs || input.evidence_refs),
      auditVerdict: input.auditVerdict || input.audit_verdict,
      nextTimeNotes: input.nextTimeNotes || input.next_time_notes,
      createdAt: input.createdAt || now,
    };
    await this.insertCompletionSummary({ id: record.taskId }, record);
    return record;
  }

  async recordMemoryCard(input = {}, { now = nowIso() } = {}) {
    const record = {
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
    };
    await this.insertMemoryCard(record);
    return record;
  }

  async listMemoryCards({ type, syncStatus, limit = 50 } = {}) {
    const values = [];
    const clauses = [];
    if (type) {
      values.push(type);
      clauses.push(`type = $${values.length}`);
    }
    if (syncStatus) {
      values.push(syncStatus);
      clauses.push(`sync_status = $${values.length}`);
    }
    values.push(limit);
    const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
    const result = await this.pool.query(`select * from memory_cards ${where} order by created_at desc limit $${values.length}`, values);
    return result.rows.map(fromDbRecord);
  }

  async searchPlanningMemory({ query = "", limit = 20 } = {}) {
    const like = `%${String(query || "").toLowerCase()}%`;
    const result = await this.pool.query(
      `select 'planning_records' as source, to_jsonb(planning_records.*) as payload from planning_records where lower(planning_summary || ' ' || coalesce(split_rationale, '')) like $1
       union all
       select 'failure_analyses' as source, to_jsonb(failure_analyses.*) as payload from failure_analyses where lower(root_cause || ' ' || coalesce(avoid_next_time, '')) like $1
       union all
       select 'completion_summaries' as source, to_jsonb(completion_summaries.*) as payload from completion_summaries where lower(summary || ' ' || coalesce(next_time_notes, '')) like $1
       union all
       select 'memory_cards' as source, to_jsonb(memory_cards.*) as payload from memory_cards where lower(content || ' ' || coalesce(title, '')) like $1
       limit $2`,
      [like, limit],
    );
    return result.rows.map((row) => ({ source: row.source, ...fromDbRecord(row.payload) }));
  }

  async withClient(fn) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async getTaskForUpdate(client, id) {
    const result = await client.query("select payload from tasks where id = $1 for update", [id]);
    if (!result.rows[0]) throw new Error(`unknown task: ${id}`);
    return normalizeDbTask(result.rows[0].payload);
  }

  async upsertTask(task, client = this.pool) {
    await client.query(
      `insert into tasks (id, charter_id, title, prompt, cwd, status, priority, attempts, max_attempts, due_at, verify_command, expected_result, acceptance_checks, audit_level, risk_level, task_kind, parent_id, depends_on, resource_keys, task_granularity, model_selection_reason, rejected_approaches, wait_state, checkpoint, heartbeat_at, run_manifest_path, payload, created_at, updated_at, started_at, completed_at, body, task_domain, lifecycle_status, execution_status, remind_at, reminder_state, due_date)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38)
       on conflict (id) do update set charter_id = excluded.charter_id, title = excluded.title, prompt = excluded.prompt, cwd = excluded.cwd, status = excluded.status, priority = excluded.priority, attempts = excluded.attempts, max_attempts = excluded.max_attempts, due_at = excluded.due_at, verify_command = excluded.verify_command, expected_result = excluded.expected_result, acceptance_checks = excluded.acceptance_checks, audit_level = excluded.audit_level, risk_level = excluded.risk_level, task_kind = excluded.task_kind, parent_id = excluded.parent_id, depends_on = excluded.depends_on, resource_keys = excluded.resource_keys, task_granularity = excluded.task_granularity, model_selection_reason = excluded.model_selection_reason, rejected_approaches = excluded.rejected_approaches, wait_state = excluded.wait_state, checkpoint = excluded.checkpoint, heartbeat_at = excluded.heartbeat_at, run_manifest_path = excluded.run_manifest_path, payload = excluded.payload, updated_at = excluded.updated_at, started_at = excluded.started_at, completed_at = excluded.completed_at, body = excluded.body, task_domain = excluded.task_domain, lifecycle_status = excluded.lifecycle_status, execution_status = excluded.execution_status, remind_at = excluded.remind_at, reminder_state = excluded.reminder_state, due_date = excluded.due_date`,
      [
        task.id, task.charterId, task.title, task.prompt, task.cwd, task.status, task.priority, task.attempts, task.maxAttempts,
        task.dueAt, task.verifyCommand, task.expectedResult, jsonb(task.acceptanceChecks), task.auditLevel, task.riskLevel, task.taskKind,
        task.parentId, jsonb(task.dependsOn), jsonb(task.resourceKeys), task.taskGranularity, task.modelSelectionReason, jsonb(task.rejectedApproaches),
        jsonb(task.waitState), task.checkpoint, task.heartbeatAt, task.runManifestPath, jsonb(task), task.createdAt, task.updatedAt, task.startedAt, task.completedAt,
        task.body, task.taskDomain, task.lifecycleStatus, task.executionStatus, task.remindAt, task.reminderState, task.dueDate,
      ],
    );
  }

  async queryJson(sql, values = []) {
    const result = await this.pool.query(sql, values);
    return result.rows.map((row) => row.payload);
  }

  async queryTasks(sql, values = []) {
    const result = await this.pool.query(sql, values);
    return result.rows.map((row) => normalizeDbTask(row.payload));
  }

  async queryRows(sql, values = []) {
    const result = await this.pool.query(sql, values);
    return result.rows.map(fromDbRecord);
  }

  async insertCompletionSummary(task, input = {}, client = this.pool, now = nowIso()) {
    const record = createCompletionSummaryRecord(task, input, now);
    await client.query(
      "insert into completion_summaries (id, task_id, run_id, status, summary, duration_ms, verification, evidence_refs, audit_verdict, next_time_notes, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [record.id, record.taskId, record.runId, record.status, record.summary, record.durationMs, jsonb(record.verification || {}), jsonb(record.evidenceRefs), record.auditVerdict, record.nextTimeNotes, record.createdAt],
    );
    return record;
  }

  async insertFailureAnalysis(task, input = {}, client = this.pool, now = nowIso()) {
    const record = createFailureAnalysisRecord(task, input, now);
    await client.query(
      "insert into failure_analyses (id, task_id, run_id, root_cause, trigger, failure_stage, recovery_action, avoid_next_time, retryable, evidence, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [record.id, record.taskId, record.runId, record.rootCause, record.trigger, record.failureStage, record.recoveryAction, record.avoidNextTime, record.retryable, jsonb(record.evidence || {}), record.createdAt || now],
    );
    return record;
  }

  async insertMemoryCard(card, client = this.pool) {
    await client.query(
      "insert into memory_cards (id, task_id, run_id, type, title, content, concepts, files, sync_status, synced_at, sync_error, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      [card.id, card.taskId, card.runId, card.type, card.title, card.content, jsonb(card.concepts), jsonb(card.files), card.syncStatus, card.syncedAt, card.syncError, card.createdAt, card.updatedAt],
    );
    return card;
  }
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

function jsonb(value) {
  return JSON.stringify(value ?? null);
}

function normalizeDbTask(payload) {
  return normalizeExistingTask(payload) || payload;
}

function createCompletionSummaryRecord(task, input = {}, now) {
  return {
    id: input.id || crypto.randomUUID(),
    taskId: input.taskId || task.id,
    runId: input.runId || task.lastRunId,
    status: input.status || task.status,
    summary: input.summary || task.summary || "",
    durationMs: input.durationMs,
    verification: input.verification || task.verification,
    evidenceRefs: normalizeStringArray(input.evidenceRefs),
    auditVerdict: input.auditVerdict,
    nextTimeNotes: input.nextTimeNotes,
    createdAt: input.createdAt || now,
  };
}

function createFailureAnalysisRecord(task, input = {}, now) {
  return {
    id: input.id || crypto.randomUUID(),
    taskId: input.taskId || task.id,
    runId: input.runId || task.lastRunId,
    rootCause: input.rootCause || task.error || "unknown",
    trigger: input.trigger,
    failureStage: input.failureStage,
    recoveryAction: input.recoveryAction,
    avoidNextTime: input.avoidNextTime,
    retryable: Boolean(input.retryable),
    evidence: input.evidence && typeof input.evidence === "object" ? input.evidence : {},
    createdAt: input.createdAt || now,
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
  }));
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

function fromDbRecord(row) {
  if (!row || typeof row !== "object") return row;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[camelCase(key)] = value;
  }
  return out;
}

function camelCase(key) {
  return key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}
