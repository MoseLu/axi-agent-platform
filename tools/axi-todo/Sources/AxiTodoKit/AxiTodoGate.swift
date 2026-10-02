import Foundation

// M1.S5: Swift mirror of lib/completion-gate.mjs.
//
// evaluateAxiTodoCompletion returns whether a task may transition to
// `.completed`. Personal-domain tasks always return `.completed` (manual
// completion stays independent — the M1 spec calls this out and the Node
// gate in lib/completion-gate.mjs already agrees).
//
// For agent-domain tasks the function blocks `.completed` whenever:
//   - task.verifyCommand is set AND verification.status is missing or failed;
//   - task.evidenceContract is set AND auditLevel ∈ {standard, strict} AND
//     task.evidenceMissing is true.
//
// In all blocked cases the function returns `.awaitingAudit(reason)` with a
// stable reason code; AxiTodoStore.updateStatus and saveTask call this before
// honoring a `.completed` patch. The desktop Web UI surfaces the reason through
// the bridge error.

public enum AxiTodoGateReason: String, Equatable {
    case personalTaskManual = "personal_task_manual"
    case verificationMissing = "verification_missing"
    case verificationFailed = "verification_failed"
    case evidenceSectionMissing = "evidence_section_missing"
    case evidenceContractMismatch = "evidence_contract_mismatch"
    case missingTask = "missing_task"
}

public enum AxiTodoCompletionDecision: Equatable {
    case completed
    case awaitingAudit(reason: String)

    public var isAwaitingAudit: Bool {
        if case .awaitingAudit = self { return true }
        return false
    }

    public var reason: String? {
        if case .awaitingAudit(let reason) = self { return reason }
        return nil
    }
}

public struct AxiTodoGateHeldError: LocalizedError, Equatable {
    public let reason: String
    public let message: String

    public init(reason: String, message: String) {
        self.reason = reason
        self.message = message
    }

    public var errorDescription: String? { message }
}

public func evaluateAxiTodoCompletion(
    task: AxiTodoTask,
    resultVerification: AxiTodoVerification? = nil
) -> AxiTodoCompletionDecision {
    if task.taskDomain == .personal {
        return .completed
    }

    let verification = resultVerification ?? task.verification
    let verificationStatus = verification.status?.trimmedNonEmpty

    if let vcmd = task.verifyCommand?.trimmedNonEmpty, !vcmd.isEmpty {
        if verificationStatus == nil {
            return .awaitingAudit(reason: AxiTodoGateReason.verificationMissing.rawValue)
        }
        if verificationStatus == "failed" {
            return .awaitingAudit(reason: AxiTodoGateReason.verificationFailed.rawValue)
        }
    }

    let evidenceContract = task.evidenceContract?.trimmedNonEmpty ?? ""
    let evidenceContractSeen = task.evidenceContractSeen?.trimmedNonEmpty ?? ""
    let auditLevel = task.auditLevel?.trimmedNonEmpty ?? "none"
    let evidenceMissing = task.evidenceMissing ?? false
    let requiresEvidence = auditLevel == "standard" || auditLevel == "strict"
    if !evidenceContract.isEmpty, requiresEvidence {
        if !evidenceContractSeen.isEmpty, evidenceContractSeen != evidenceContract {
            return .awaitingAudit(reason: AxiTodoGateReason.evidenceContractMismatch.rawValue)
        }
        if evidenceMissing {
            return .awaitingAudit(reason: AxiTodoGateReason.evidenceSectionMissing.rawValue)
        }
    }

    return .completed
}

public func describeAxiTodoGateDecision(
    task: AxiTodoTask,
    decision: AxiTodoCompletionDecision
) -> String {
    switch decision {
    case .completed:
        return ""
    case .awaitingAudit(let reason):
        return "⚠️ completion gate held task: \(reason)"
    }
}