// A-segment evidence-guardrail tests for tools/axi-todo.
// Run with: node --test tools/axi-todo/test/evidence-guardrails.test.mjs
//
// Covers A1 (buildCodexPrompt injection), A3 (parseEvidenceSection /
// parseClaimedFiles), A4 (appendBounded + runProcess truncation), and A2
// (completeTask gates). The end-to-end E.1 / E.2 / E.3 cases are manual and
// documented in docs/axi-todo-evidence-guardrails-test-plan.md.

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import {
  buildCodexPrompt,
  parseClaimedFiles,
  parseEvidenceSection,
} from "../lib/codex-runner.mjs";
import { runProcess, summarizeProcessOutput } from "../lib/process.mjs";
import { TaskStore } from "../lib/store.mjs";

// ---------------------------------------------------------------------------
// A1 — buildCodexPrompt injects Rejected Approaches + Evidence Contract
// ---------------------------------------------------------------------------

test("A1.1: buildCodexPrompt omits the sections when both fields are empty", () => {
  const prompt = buildCodexPrompt({
    id: "t",
    title: "T",
    prompt: "Do X",
    cwd: "/tmp",
    verifyCommand: "echo ok",
    rejectedApproaches: [],
    evidenceContract: "",
  });
  assert.doesNotMatch(prompt, /## Rejected Approaches/);
  assert.doesNotMatch(prompt, /## Evidence Contract/);
  // Hard contract still lives in Completion Contract.
  assert.match(prompt, /## Evidence/);
  assert.match(prompt, /Completion Contract/);
});

test("A1.2: buildCodexPrompt renders the Rejected Approaches bullets", () => {
  const prompt = buildCodexPrompt({
    id: "t",
    title: "T",
    prompt: "Do X",
    cwd: "/tmp",
    verifyCommand: "",
    rejectedApproaches: [
      "Don't touch the daemon while it is running",
      "Don't bump the node version",
    ],
  });
  const section = prompt.match(/## Rejected Approaches\n([\s\S]*?)\n## /);
  assert.ok(section, "expected a Rejected Approaches section");
  const body = section[1];
  assert.match(body, /- Don't touch the daemon while it is running/);
  assert.match(body, /- Don't bump the node version/);
});

test("A1.3: buildCodexPrompt renders the Evidence Contract text", () => {
  const prompt = buildCodexPrompt({
    id: "t",
    title: "T",
    prompt: "Do X",
    cwd: "/tmp",
    verifyCommand: "",
    evidenceContract: "Report the changed files and the verification exit code.",
  });
  const section = prompt.match(/## Evidence Contract\n([\s\S]*?)\n## /);
  assert.ok(section, "expected an Evidence Contract section");
  assert.match(section[1], /Report the changed files and the verification exit code\./);
});

test("A1.4: ordering — Rejected Approaches precedes Evidence Contract", () => {
  const prompt = buildCodexPrompt({
    id: "t",
    title: "T",
    prompt: "Do X",
    cwd: "/tmp",
    verifyCommand: "",
    rejectedApproaches: ["Don't do A"],
    evidenceContract: "Report files.",
  });
  const idxRejected = prompt.indexOf("## Rejected Approaches");
  const idxContract = prompt.indexOf("## Evidence Contract");
  const idxCompletion = prompt.indexOf("## Completion Contract");
  assert.ok(idxRejected > -1 && idxContract > -1, "both sections present");
  assert.ok(idxRejected < idxContract, "Rejected Approaches before Evidence Contract");
  assert.ok(idxContract < idxCompletion, "Evidence Contract before Completion Contract");
});

test("A1.5: junk values in rejectedApproaches are dropped", () => {
  const prompt = buildCodexPrompt({
    id: "t",
    title: "T",
    prompt: "Do X",
    cwd: "/tmp",
    verifyCommand: "",
    rejectedApproaches: ["", "  ", null, 42, "Keep this one"],
  });
  const section = prompt.match(/## Rejected Approaches\n([\s\S]*?)\n## /);
  assert.ok(section, "section should still render when at least one real entry exists");
  assert.match(section[1], /- Keep this one/);
  assert.doesNotMatch(section[1], /^-\s*$/m);
});

test("A1.6: rejectedApproaches all-blank falls back to no section", () => {
  const prompt = buildCodexPrompt({
    id: "t",
    title: "T",
    prompt: "Do X",
    cwd: "/tmp",
    verifyCommand: "",
    rejectedApproaches: ["", "  ", "\t"],
  });
  assert.doesNotMatch(prompt, /## Rejected Approaches/);
});

// ---------------------------------------------------------------------------
// A3 — parseEvidenceSection + parseClaimedFiles
// ---------------------------------------------------------------------------

test("A3.1: well-formed Evidence block", () => {
  const text = `All done.\n\n## Evidence\n- claim: Fixed login.\n- files:\n  - src/auth.ts\n  - src/auth.test.ts\n- checks:\n  - pnpm test: 0 failures\n`;
  const out = parseEvidenceSection(text);
  assert.equal(out.missing, false);
  assert.equal(out.claim, "Fixed login.");
  assert.deepEqual(out.files, ["src/auth.ts", "src/auth.test.ts"]);
  assert.deepEqual(out.checks, ["pnpm test: 0 failures"]);
});

test("A3.2: claim only is enough", () => {
  const out = parseEvidenceSection("## Evidence\n- claim: Updated docs.\n");
  assert.equal(out.missing, false);
  assert.equal(out.claim, "Updated docs.");
  assert.deepEqual(out.files, []);
});

test("A3.3: files only is enough", () => {
  const out = parseEvidenceSection("## Evidence\n- files:\n  - x.ts\n");
  assert.equal(out.missing, false);
  assert.equal(out.claim, "");
  assert.deepEqual(out.files, ["x.ts"]);
});

test("A3.4: empty Evidence section counts as missing", () => {
  const out = parseEvidenceSection("## Evidence\n\n## Next Section\n");
  assert.equal(out.missing, true);
});

test("A3.5: no heading at all counts as missing", () => {
  assert.equal(parseEvidenceSection("just plain text").missing, true);
  assert.equal(parseEvidenceSection("").missing, true);
  assert.equal(parseEvidenceSection(null).missing, true);
});

test("A3.6: truncated at EOF with claim only", () => {
  const out = parseEvidenceSection("## Evidence\n- claim: half");
  assert.equal(out.missing, false);
  assert.equal(out.claim, "half");
});

test("A3.7: sibling key stops the bullet collector", () => {
  const text = "## Evidence\n- files:\n  - a\n  - b\n- checks:\n  - c\n";
  const out = parseEvidenceSection(text);
  assert.deepEqual(out.files, ["a", "b"]);
  assert.deepEqual(out.checks, ["c"]);
});

test("A3.8: parseClaimedFiles extracts backticked bullets", () => {
  const text = "Changed:\n- file: `src/foo.ts`\n- file: `src/bar.ts`\n";
  const out = parseClaimedFiles(text);
  assert.deepEqual(out, ["src/foo.ts", "src/bar.ts"]);
});

test("A3.9: parseClaimedFiles filters junk and spaces in path", () => {
  const text = "Garbage:\n- file: ` `\n- file: `a path with spaces`\n- file: ``\n";
  const out = parseClaimedFiles(text);
  assert.deepEqual(out, []);
});

test("A3.10: parseClaimedFiles dedups repeated paths", () => {
  const text = "- file: `src/x.ts`\n- file: `src/x.ts`\n";
  assert.deepEqual(parseClaimedFiles(text), ["src/x.ts"]);
});

// ---------------------------------------------------------------------------
// A4 — appendBounded + runProcess surface truncation
// ---------------------------------------------------------------------------

test("A4.1: appendBounded under the limit is identity", async () => {
  const result = await runProcess("printf", ["abcde"], { maxBuffer: 10 });
  assert.equal(result.truncated.stdout, false);
  assert.equal(result.droppedBytes.stdout, 0);
  assert.equal(result.stdout, "abcde");
});

test("A4.2: runProcess reports stdout truncation with dropped byte count", async () => {
  // Print 200_000 bytes but cap the buffer at 1024.
  const result = await runProcess("printf", ["x".repeat(200_000)], { maxBuffer: 1024 });
  assert.equal(result.truncated.stdout, true);
  assert.equal(result.droppedBytes.stdout, 200_000 - 1024);
  assert.equal(result.stdout.length, 1024);
  assert.equal(result.stdout, "x".repeat(1024));
  // summarizeProcessOutput stays backward-compatible — it does not see the
  // new fields and continues to return the text.
  assert.equal(summarizeProcessOutput(result), "x".repeat(1024));
});

// ---------------------------------------------------------------------------
// A2 — completeTask gates
// ---------------------------------------------------------------------------

async function makeTempStore() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-eg-"));
  const store = new TaskStore({ home });
  // Seed a minimal task with the gate-relevant fields.
  const task = await store.addTask({
    title: "T",
    prompt: "do it",
    cwd: home,
    auditLevel: "standard",
    evidenceContract: "report the changed files",
    verifyCommand: "true",
  });
  // Claim it so the task transitions to running (mirrors real runner flow).
  await store.claimNextTask();
  return { store, home, taskId: task.id };
}

test("A2.1: evidence OK, no contract → completed with no warning", async () => {
  const { store, taskId } = await makeTempStore();
  await store.completeTask(taskId, {
    success: true,
    runId: "r1",
    outputPath: "/tmp/r1.last-message.txt",
    summary: "ok",
    evidenceMissing: false,
    auditLevel: "none",
    evidenceContract: "",
  });
  const after = await store.getTask(taskId);
  assert.equal(after.status, "completed");
  // The evidenceMissing flag is only meaningful on the audit lane; we never
  // set it on a fully completed task.
  assert.ok(after.evidenceMissing !== true);
  assert.doesNotMatch(after.summary, /⚠️ axi-todo warnings/);
  const audits = (await store.readState()).auditReviews;
  assert.equal(audits.length, 0);
});

test("A2.2: evidence OK, contract present → completed, no audit row", async () => {
  const { store, taskId } = await makeTempStore();
  await store.completeTask(taskId, {
    success: true,
    runId: "r2",
    outputPath: "/tmp/r2.last-message.txt",
    summary: "ok",
    evidenceMissing: false,
    auditLevel: "standard",
    evidenceContract: "report the changed files",
  });
  const after = await store.getTask(taskId);
  assert.equal(after.status, "completed");
  assert.ok(after.evidenceMissing !== true);
  const audits = (await store.readState()).auditReviews;
  assert.equal(audits.length, 0);
});

test("A2.3: evidence missing, contract + standard → awaiting_audit + audit row", async () => {
  const { store, taskId } = await makeTempStore();
  await store.completeTask(taskId, {
    success: true,
    runId: "r3",
    outputPath: "/tmp/r3.last-message.txt",
    summary: "ok",
    evidenceMissing: true,
    auditLevel: "standard",
    evidenceContract: "report the changed files",
  });
  const after = await store.getTask(taskId);
  assert.equal(after.status, "awaiting_audit");
  assert.equal(after.evidenceMissing, true);
  assert.equal(after.completedAt, undefined);
  assert.equal(after.error, "Evidence section missing in runner output");
  const audits = (await store.readState()).auditReviews;
  assert.equal(audits.length, 1);
  assert.equal(audits[0].verdict, "pending");
  assert.equal(audits[0].taskId, taskId);
  assert.equal(audits[0].auditLevel, "standard");
  assert.match(audits[0].reason, /Evidence section missing/);
  assert.deepEqual(audits[0].evidenceGaps, ["evidence-section-missing"]);
  // history should record the audit_waiting event
  const last = after.history.at(-1);
  assert.equal(last.event, "audit_waiting");
});

test("A2.4: evidence missing, contract + strict → awaiting_audit (B1 tightened)", async () => {
  // B1 promotes `auditLevel: "strict"` to the same hard gate as `standard`:
  // a strict task with a missing Evidence block MUST be held for audit,
  // not silently completed with a soft warning. The operator (or a follow-up
  // agent) has to either re-run with a proper Evidence section or escalate
  // the verdict via recordAuditReview.
  const { store, taskId } = await makeTempStore();
  await store.updateTask(taskId, { auditLevel: "strict" });
  await store.completeTask(taskId, {
    success: true,
    runId: "r4",
    summary: "ok",
    evidenceMissing: true,
    auditLevel: "strict",
    evidenceContract: "report the changed files",
  });
  const after = await store.getTask(taskId);
  assert.equal(after.status, "awaiting_audit");
  const audits = (await store.readState()).auditReviews;
  assert.equal(audits.length, 1);
  assert.equal(audits[0].auditLevel, "strict");
});

test("A2.5: evidence missing, auditLevel=none → completed but warning logged", async () => {
  const { store, taskId } = await makeTempStore();
  await store.updateTask(taskId, { auditLevel: "none" });
  await store.completeTask(taskId, {
    success: true,
    runId: "r5",
    summary: "ok",
    evidenceMissing: true,
    auditLevel: "none",
    evidenceContract: "report the changed files",
  });
  const after = await store.getTask(taskId);
  assert.equal(after.status, "completed");
  // evidenceMissing is only set on the audit lane.
  assert.ok(after.evidenceMissing !== true);
  // Soft warning is what the operator sees in this branch.
  assert.match(after.summary, /⚠️ axi-todo warnings/);
  assert.match(after.summary, /evidence-section-missing-in-last-message/);
  const audits = (await store.readState()).auditReviews;
  assert.equal(audits.length, 0);
});

test("A2.6: claim file mismatch → soft warning, no audit row", async () => {
  const { store, taskId, home } = await makeTempStore();
  await store.completeTask(taskId, {
    success: true,
    runId: "r6",
    summary: "ok",
    evidenceMissing: false,
    auditLevel: "none",
    evidenceContract: "",
    claimFiles: ["definitely-missing.ts"],
    cwd: home,
  });
  const after = await store.getTask(taskId);
  assert.equal(after.status, "completed");
  assert.match(after.summary, /claimed-file-not-found: definitely-missing\.ts/);
  const last = after.history.at(-1);
  assert.deepEqual(last.data.claimedFileMismatches, ["definitely-missing.ts"]);
});

test("A2.7: claim file exists → no mismatch warning", async () => {
  const { store, taskId, home } = await makeTempStore();
  await fs.writeFile(path.join(home, "real.ts"), "// hi\n");
  await store.completeTask(taskId, {
    success: true,
    runId: "r7",
    summary: "ok",
    evidenceMissing: false,
    auditLevel: "none",
    evidenceContract: "",
    claimFiles: ["real.ts"],
    cwd: home,
  });
  const after = await store.getTask(taskId);
  assert.equal(after.status, "completed");
  assert.doesNotMatch(after.summary, /claimed-file-not-found/);
  const last = after.history.at(-1);
  assert.equal(last.data.claimedFileMismatches, undefined);
});

test("A2.8: truncation from runner surfaces in summary warning block", async () => {
  const { store, taskId } = await makeTempStore();
  await store.completeTask(taskId, {
    success: true,
    runId: "r8",
    summary: "ok",
    evidenceMissing: false,
    auditLevel: "none",
    evidenceContract: "",
    truncated: { stdout: true, stderr: false, droppedBytes: { stdout: 4096, stderr: 0 } },
  });
  const after = await store.getTask(taskId);
  assert.equal(after.status, "completed");
  assert.match(after.summary, /runner-stdout-truncated-dropped-4096b/);
});

test("A2.9: gate fires AND soft warnings still surface in summary", async () => {
  const { store, taskId, home } = await makeTempStore();
  await store.completeTask(taskId, {
    success: true,
    runId: "r9",
    summary: "ok",
    evidenceMissing: true, // hard gate fires
    auditLevel: "standard",
    evidenceContract: "report the changed files",
    claimFiles: ["absent.ts"],
    truncated: { stdout: true, stderr: false, droppedBytes: { stdout: 2048, stderr: 0 } },
    cwd: home,
  });
  const after = await store.getTask(taskId);
  assert.equal(after.status, "awaiting_audit");
  // soft warnings still attached for human inspection
  assert.match(after.summary, /claimed-file-not-found: absent\.ts/);
  assert.match(after.summary, /runner-stdout-truncated-dropped-2048b/);
  // Find the audit_waiting event specifically — the audit review follow-up
  // appends a separate "updated" history event after the mutate commits, so
  // we cannot rely on `.at(-1)`.
  const auditEvent = after.history.find((entry) => entry.event === "audit_waiting");
  assert.ok(auditEvent, "expected an audit_waiting event in history");
  assert.deepEqual(auditEvent.data.claimedFileMismatches, ["absent.ts"]);
});

test("A2.10: re-running completeTask on a held task appends a second audit_waiting event", async () => {
  const { store, taskId } = await makeTempStore();
  await store.completeTask(taskId, {
    success: true,
    runId: "r10a",
    summary: "ok",
    evidenceMissing: true,
    auditLevel: "standard",
    evidenceContract: "report the changed files",
  });
  // The task is now in awaiting_audit; completeTask does not refuse re-entry
  // because the gate is evaluated from the input shape, not the prior status.
  await store.completeTask(taskId, {
    success: true,
    runId: "r10b",
    summary: "ok",
    evidenceMissing: true,
    auditLevel: "standard",
    evidenceContract: "report the changed files",
  });
  const after = await store.getTask(taskId);
  // Each completeTask call produces exactly one audit_waiting history event
  // plus one auditReviews record (recordAuditReview is called once per gate).
  assert.equal(after.history.filter((entry) => entry.event === "audit_waiting").length, 2);
  const audits = (await store.readState()).auditReviews;
  assert.equal(audits.length, 2);
  assert.equal(audits[0].runId, "r10a");
  assert.equal(audits[1].runId, "r10b");
});
