// Single source of truth for "can this task be marked completed, or must it be
// held in awaiting_audit?". All completion paths (JSON TaskStore.completeTask,
// PostgresTaskStore.completeTask, both markVerificationResult methods, both
// updateTask paths that accept status="completed") MUST call this. Direct
// status writes that bypass this gate are a contract violation and a known
// reason the F02 audit found: stale, completed, or pending entries that the
// runner never actually verified.
//
// Personal-domain tasks (task.taskDomain === "personal") bypass the gate
// entirely. The user explicitly asked for personal manual completion to
// remain independent; the M1 spec calls it out, and synchronizeTaskState in
// schema.mjs treats the personal lifecycle as a separate state diagram.

const AUDIT_LEVELS_THAT_REQUIRE_EVIDENCE = new Set(["standard", "strict"]);

export function evaluateCompletion(task, result = {}) {
  if (!task || typeof task !== "object") {
    return { status: "awaiting_audit", reason: "missing_task" };
  }

  if (task.taskDomain === "personal") {
    return { status: "completed", reason: "personal_task_manual" };
  }

  // Resolve the contract. The runner is allowed to echo the contract back on
  // the result (it MUST, after S4 propagates it), but the source of truth is
  // the task itself — otherwise an executor could quietly turn the contract
  // off and bypass the audit.
  const evidenceContract = String(
    (typeof result?.evidenceContract === "string" && result.evidenceContract.trim()) ||
    (typeof task.evidenceContract === "string" && task.evidenceContract.trim()) ||
    ""
  );
  const evidenceContractSeen = String(
    (typeof result?.evidenceContractSeen === "string" && result.evidenceContractSeen.trim()) ||
    (typeof task.evidenceContractSeen === "string" && task.evidenceContractSeen.trim()) ||
    ""
  );
  const auditLevel = (typeof result?.auditLevel === "string" && result.auditLevel) ||
    task.auditLevel || "none";
  const evidenceMissing = Boolean(
    result?.evidenceMissing ?? task?.evidenceMissing ?? false
  );

  // Verification must be present and passing when the task declared one.
  const verification = result?.verification ?? task?.verification;
  const verificationStatus = verification?.status;
  if (task.verifyCommand) {
    if (!verificationStatus) {
      return { status: "awaiting_audit", reason: "verification_missing" };
    }
    if (verificationStatus === "failed") {
      return { status: "awaiting_audit", reason: "verification_failed" };
    }
  }

  // Evidence contract.
  if (evidenceContract && AUDIT_LEVELS_THAT_REQUIRE_EVIDENCE.has(auditLevel)) {
    // Stale evidence: task.evidenceContract was raised since the runner last
    // emitted evidence. The captured contract no longer satisfies the new
    // requirement, so the gate must hold even if evidenceMissing is false.
    if (evidenceContractSeen && evidenceContractSeen !== evidenceContract) {
      return { status: "awaiting_audit", reason: "evidence_contract_mismatch" };
    }
    if (evidenceMissing) {
      return { status: "awaiting_audit", reason: "evidence_section_missing" };
    }
  }

  return { status: "completed", reason: null };
}

/**
 * Surface a stable, machine-parseable summary line for the task's history
 * and audit-review records. Callers should pass the gate decision and the
 * raw inputs so the operator can see WHY the task is held.
 */
export function describeGateDecision(decision, { task = {}, result = {} } = {}) {
  if (!decision || decision.status === "completed") return "";
  const auditLevel = result?.auditLevel || task.auditLevel || "none";
  const hasEvidenceContract = Boolean(
    (task.evidenceContract || result?.evidenceContract || "").toString().trim()
  );
  const hasVerifyCommand = Boolean(task.verifyCommand);
  const reason = decision.reason || "gate_failed";
  const bits = [];
  if (reason === "verification_failed") bits.push("verification=status:failed");
  else if (reason === "verification_missing") bits.push("verification=absent");
  else if (reason === "evidence_section_missing") bits.push("evidence=missing");
  else if (reason === "evidence_contract_mismatch") bits.push("evidence=stale_contract");
  else bits.push("gate=" + reason);
  if (hasEvidenceContract) bits.push(`auditLevel=${auditLevel}`);
  if (hasVerifyCommand) bits.push("verifyCommand=declared");
  return `⚠️ axi-todo completion gate held task: ${bits.join("; ")}`;
}