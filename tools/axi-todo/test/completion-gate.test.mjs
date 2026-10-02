import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TaskStore } from "../lib/store.mjs";
import { PostgresTaskStore } from "../lib/postgres-store.mjs";
import {
  evaluateCompletion,
  describeGateDecision,
} from "../lib/completion-gate.mjs";

// M1.S6: regression coverage for the unified completion gate. Each category
// listed in the user spec (缺证据 / 验证失败 / 旧版本证据 / 直接 update /
// 个人手动) gets one test for the JSON store and a parity test that mounts
// the PostgresTaskStore prototype via Object.create so the assertion never
// needs a real database. The Swift side has its own smoke tests in
// Sources/AxiTodoStoreSmokeTests/main.swift that mirror the same cases.

test("gate holds agent task when evidence contract is unmet (strict + evidenceMissing)", () => {
  const task = {
    taskDomain: "agent",
    verifyCommand: "true",
    evidenceContract: "Require claim",
    auditLevel: "strict",
    evidenceMissing: true,
  };
  const result = evaluateCompletion(task, {
    success: true,
    evidenceContract: "Require claim",
    auditLevel: "strict",
    evidenceMissing: true,
    verification: { status: "passed" },
  });
  assert.equal(result.status, "awaiting_audit");
  assert.equal(result.reason, "evidence_section_missing");
});

test("gate holds agent task when verification command failed", () => {
  const task = {
    taskDomain: "agent",
    verifyCommand: "true",
    evidenceMissing: false,
  };
  const result = evaluateCompletion(task, {
    success: true,
    evidenceMissing: false,
    verification: { status: "failed" },
  });
  assert.equal(result.status, "awaiting_audit");
  assert.equal(result.reason, "verification_failed");
});

test("gate holds agent task when evidence contract was raised after evidence was captured", () => {
  const task = {
    taskDomain: "agent",
    verifyCommand: "true",
    evidenceContract: "Require claim v2",
    evidenceContractSeen: "Require claim v1",
    auditLevel: "strict",
    evidenceMissing: false,
  };
  const result = evaluateCompletion(task, {
    success: true,
    evidenceMissing: false,
    verification: { status: "passed" },
  });
  assert.equal(result.status, "awaiting_audit");
  assert.equal(result.reason, "evidence_contract_mismatch");
});

test("gate allows agent completion when evidence, verification, and contract all line up", () => {
  const task = {
    taskDomain: "agent",
    verifyCommand: "true",
    evidenceContract: "Require claim",
    evidenceContractSeen: "Require claim",
    auditLevel: "strict",
    evidenceMissing: false,
  };
  const result = evaluateCompletion(task, {
    success: true,
    evidenceMissing: false,
    verification: { status: "passed" },
  });
  assert.equal(result.status, "completed");
  assert.equal(result.reason, null);
});

test("gate always lets personal-domain tasks complete manually", () => {
  const task = {
    taskDomain: "personal",
    // Even an aggressive contract cannot block personal completion.
    verifyCommand: "true",
    evidenceContract: "Require claim",
    auditLevel: "strict",
    evidenceMissing: true,
  };
  const result = evaluateCompletion(task, {
    success: true,
    evidenceMissing: true,
    verification: { status: "failed" },
  });
  assert.equal(result.status, "completed");
  assert.equal(result.reason, "personal_task_manual");
});

test("describeGateDecision renders each gate reason into a stable summary string", () => {
  const task = {
    taskDomain: "agent",
    verifyCommand: "true",
    evidenceContract: "Need claim",
    auditLevel: "strict",
  };
  assert.match(
    describeGateDecision(
      { status: "awaiting_audit", reason: "verification_failed" },
      { task },
    ),
    /verification=status:failed/,
  );
  assert.match(
    describeGateDecision(
      { status: "awaiting_audit", reason: "evidence_section_missing" },
      { task },
    ),
    /evidence=missing/,
  );
  assert.match(
    describeGateDecision(
      { status: "awaiting_audit", reason: "evidence_contract_mismatch" },
      { task },
    ),
    /evidence=stale_contract/,
  );
});

test("JSON store: completeTask holds agent task with strict + missing evidence in awaiting_audit", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-gate-json-"));
  const store = new TaskStore({ home });
  const task = await store.addTask({
    title: "Strict gate",
    prompt: "Do work",
    cwd: home,
    verifyCommand: "true",
    evidenceContract: "Require claim",
    auditLevel: "strict",
  });
  const completed = await store.completeTask(task.id, {
    success: true,
    summary: "ran",
    runId: "r1",
    outputPath: "/tmp/out",
    verification: { status: "passed" },
    evidenceContract: "Require claim",
    auditLevel: "strict",
    evidenceMissing: true,
  });
  assert.equal(completed.status, "awaiting_audit");
  assert.equal(completed.evidenceMissing, true);
  assert.match(completed.error || "", /完工验收门/);
});

test("JSON store: completeTask demotes to awaiting_audit when verification failed", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-gate-json-verify-"));
  const store = new TaskStore({ home });
  const task = await store.addTask({
    title: "Verify failed",
    prompt: "Do work",
    cwd: home,
    verifyCommand: "true",
  });
  const completed = await store.completeTask(task.id, {
    success: true,
    summary: "ran",
    runId: "r1",
    outputPath: "/tmp/out",
    verification: { status: "failed", exitCode: 1 },
  });
  assert.equal(completed.status, "awaiting_audit");
  assert.equal(completed.verification?.status, "failed");
});

test("JSON store: completeTask holds when evidenceContractSeen differs from evidenceContract", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-gate-json-stale-"));
  const store = new TaskStore({ home });
  const task = await store.addTask({
    title: "Stale evidence",
    prompt: "Do work",
    cwd: home,
    verifyCommand: "true",
    evidenceContract: "Require claim v2",
    evidenceContractSeen: "Require claim v1",
    auditLevel: "strict",
    evidenceMissing: false,
  });
  const completed = await store.completeTask(task.id, {
    success: true,
    summary: "ran",
    runId: "r1",
    outputPath: "/tmp/out",
    verification: { status: "passed" },
    evidenceContract: "Require claim v2",
    auditLevel: "strict",
    evidenceMissing: false,
    evidenceContractSeen: "Require claim v1",
  });
  assert.equal(completed.status, "awaiting_audit");
  assert.match(completed.error || "", /完工验收门/);
});

test("JSON store: updateTask({status: 'completed'}) cannot bypass the gate on agent tasks", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-gate-json-update-"));
  const store = new TaskStore({ home });
  const task = await store.addTask({
    title: "Direct status flip",
    prompt: "Do work",
    cwd: home,
    verifyCommand: "true",
    evidenceContract: "Require claim",
    auditLevel: "strict",
    evidenceMissing: true,
  });
  const patched = await store.updateTask(
    task.id,
    { status: "completed" },
    { note: "Direct completion attempt from MCP" },
  );
  assert.equal(patched.status, "awaiting_audit");
});

test("JSON store: personal tasks still complete manually via updateTask", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-gate-json-personal-"));
  const store = new TaskStore({ home });
  const task = await store.addTask({
    title: "Buy milk",
    prompt: "On the way home",
    cwd: home,
    taskDomain: "personal",
  });
  const completed = await store.completePersonalTask(task.id);
  assert.equal(completed.status, "completed");
  const reopened = await store.updateTask(task.id, { status: "pending" });
  assert.equal(reopened.status, "pending");
});

test("JSON store: markVerificationResult does not flip awaiting_audit back to completed when evidence is missing", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-gate-json-recheck-"));
  const store = new TaskStore({ home });
  const task = await store.addTask({
    title: "Recheck path",
    prompt: "Do work",
    cwd: home,
    verifyCommand: "true",
    evidenceContract: "Require claim",
    auditLevel: "strict",
    evidenceMissing: true,
  });
  await store.completeTask(task.id, {
    success: true,
    summary: "ran",
    runId: "r1",
    outputPath: "/tmp/out",
    verification: { status: "passed" },
    evidenceContract: "Require claim",
    auditLevel: "strict",
    evidenceMissing: true,
  });
  const afterRecheck = await store.markVerificationResult(task.id, {
    status: "passed",
    exitCode: 0,
  });
  assert.equal(afterRecheck.status, "awaiting_audit");
});

test("Postgres parity: completeTask holds agent task when evidence is missing (mocked I/O)", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-gate-pg-"));
  const jsonStore = new TaskStore({ home });
  const task = await jsonStore.addTask({
    title: "PG parity",
    prompt: "Do work",
    cwd: home,
    verifyCommand: "true",
    evidenceContract: "Require claim",
    auditLevel: "strict",
  });
  await jsonStore.completeTask(task.id, {
    success: true,
    summary: "ran",
    runId: "r1",
    outputPath: "/tmp/out",
    verification: { status: "passed" },
    evidenceContract: "Require claim",
    auditLevel: "strict",
    evidenceMissing: true,
  });
  const persistedTask = (await jsonStore.listTasks())[0];

  // Object.create skips the constructor/Pool. Overriding withClient and
  // getTaskForUpdate/upsertTask isolates the method under test from any
  // network/database; this is the same pattern the original
  // completion-gate-repro.mjs uses to prove F02 without a real DB.
  const pgStore = Object.create(PostgresTaskStore.prototype);
  let persisted;
  pgStore.withClient = async (fn) => fn({ query: async () => ({ rows: [] }) });
  pgStore.getTaskForUpdate = async () => structuredClone(persistedTask);
  pgStore.upsertTask = async (task) => {
    persisted = structuredClone(task);
  };

  const result = await pgStore.completeTask(persistedTask.id, {
    success: true,
    summary: "ran again",
    runId: "r2",
    outputPath: "/tmp/out2",
    verification: { status: "passed" },
    evidenceContract: "Require claim",
    auditLevel: "strict",
    evidenceMissing: true,
  });

  assert.equal(result.status, "awaiting_audit");
  assert.equal(persisted.status, "awaiting_audit");
});

test("Postgres parity: completeTask holds when verification status is failed (mocked I/O)", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-gate-pg-verify-"));
  const jsonStore = new TaskStore({ home });
  const task = await jsonStore.addTask({
    title: "PG verify failed",
    prompt: "Do work",
    cwd: home,
    verifyCommand: "true",
  });
  const seeded = await jsonStore.completeTask(task.id, {
    success: true,
    summary: "ran",
    runId: "r1",
    outputPath: "/tmp/out",
    verification: { status: "failed", exitCode: 1 },
  });
  assert.equal(seeded.status, "awaiting_audit");

  const pgStore = Object.create(PostgresTaskStore.prototype);
  let persisted;
  pgStore.withClient = async (fn) => fn({ query: async () => ({ rows: [] }) });
  pgStore.getTaskForUpdate = async () => structuredClone(seeded);
  pgStore.upsertTask = async (task) => {
    persisted = structuredClone(task);
  };
  const result = await pgStore.completeTask(seeded.id, {
    success: true,
    summary: "ran again",
    runId: "r2",
    outputPath: "/tmp/out2",
    verification: { status: "failed", exitCode: 1 },
  });
  assert.equal(result.status, "awaiting_audit");
  assert.equal(persisted.status, "awaiting_audit");
});

test("Postgres parity: updateTask({status: 'completed'}) is rejected on agent task (mocked I/O)", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-gate-pg-update-"));
  const jsonStore = new TaskStore({ home });
  const task = await jsonStore.addTask({
    title: "PG direct flip",
    prompt: "Do work",
    cwd: home,
    verifyCommand: "true",
    evidenceContract: "Require claim",
    auditLevel: "strict",
    evidenceMissing: true,
  });
  const seeded = await jsonStore.updateTask(
    task.id,
    { status: "running" },
    { note: "seed running" },
  );

  const pgStore = Object.create(PostgresTaskStore.prototype);
  let persisted;
  pgStore.withClient = async (fn) => fn({});
  pgStore.getTaskForUpdate = async () => structuredClone(seeded);
  pgStore.upsertTask = async (task) => {
    persisted = structuredClone(task);
  };

  const result = await pgStore.updateTask(
    seeded.id,
    { status: "completed" },
    { note: "Direct completion attempt" },
  );

  assert.equal(result.status, "awaiting_audit");
  assert.equal(persisted.status, "awaiting_audit");
});