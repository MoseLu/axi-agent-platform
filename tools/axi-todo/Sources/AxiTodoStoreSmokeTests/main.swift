import AxiTodoKit
import Foundation

try runStoreSmokeTests()

private func runStoreSmokeTests() throws {
    try storeCreatesAndUpdatesTasksInNodeCompatibleShape()
    try storeReadsMixedHistoryDataWrittenByRunner()
    try personalTasksStayOutOfTheAgentExecutionShape()
    try storeDeletesTasksAndRejectsRunningDeletion()
    try statusUpdateCanRequeueFailedTask()
    try gateAllowsAgentCompletedWhenContractAndSignoffLineUp()
    try gateHoldsAgentCompletedWhenEvidenceIsMissing()
    try gateHoldsAgentCompletedWhenVerificationFailed()
    try gateHoldsAgentCompletedWhenVerificationMissingEntirely()
    try saveTaskDemotesUnverifiedAgentCompletedToAwaitingAudit()
    try updateStatusDemotesUnverifiedAgentCompletedToAwaitingAudit()
    try personalCompletionStillPassesThroughGate()
    // M6 track-2: Swift mirror of JSON source/importedAt provenance.
    try storeReadsImportedPostgresProvenanceFieldsFromJSON()
    try storeReadsNativeTasksWithNilProvenanceFields()
    try storeRoundTripsProvenanceFieldsThroughReencode()
    print("AxiTodoStoreSmokeTests passed")
}

private func gateAllowsAgentCompletedWhenContractAndSignoffLineUp() throws {
    let homeURL = temporaryDirectory()
    let store = AxiTodoStore(homeURL: homeURL)
    let task = try store.addTask(title: "Allow", prompt: "Do work", cwd: homeURL.path, verifyCommand: "true")
    var edited = task
    edited.evidenceContract = "Need claim"
    edited.auditLevel = "strict"
    edited.evidenceMissing = false
    let decision = evaluateAxiTodoCompletion(task: edited, resultVerification: AxiTodoVerification(status: "passed"))
    try expect(decision == .completed, "agent task with evidence + verification should be allowed to complete")
}

private func gateHoldsAgentCompletedWhenEvidenceIsMissing() throws {
    let homeURL = temporaryDirectory()
    let store = AxiTodoStore(homeURL: homeURL)
    let task = try store.addTask(title: "Evidence missing", prompt: "Do work", cwd: homeURL.path, verifyCommand: "true")
    var edited = task
    edited.evidenceContract = "Need claim"
    edited.auditLevel = "strict"
    edited.evidenceMissing = true
    let decision = evaluateAxiTodoCompletion(task: edited, resultVerification: AxiTodoVerification(status: "passed"))
    try expect(decision.isAwaitingAudit, "evidence missing should hold agent completion")
    try expect(decision.reason == AxiTodoGateReason.evidenceSectionMissing.rawValue,
               "evidence-missing reason should be evidence_section_missing")
}

private func gateHoldsAgentCompletedWhenVerificationFailed() throws {
    let homeURL = temporaryDirectory()
    let store = AxiTodoStore(homeURL: homeURL)
    let task = try store.addTask(title: "Verify failed", prompt: "Do work", cwd: homeURL.path, verifyCommand: "true")
    let decision = evaluateAxiTodoCompletion(task: task, resultVerification: AxiTodoVerification(status: "failed"))
    try expect(decision.isAwaitingAudit, "verification failed should hold agent completion")
    try expect(decision.reason == AxiTodoGateReason.verificationFailed.rawValue,
               "verification-failed reason should be verification_failed")
}

private func gateHoldsAgentCompletedWhenVerificationMissingEntirely() throws {
    let homeURL = temporaryDirectory()
    let store = AxiTodoStore(homeURL: homeURL)
    let task = try store.addTask(title: "Verify missing", prompt: "Do work", cwd: homeURL.path, verifyCommand: "true")
    let decision = evaluateAxiTodoCompletion(task: task, resultVerification: nil)
    try expect(decision.isAwaitingAudit, "verification missing should hold agent completion")
    try expect(decision.reason == AxiTodoGateReason.verificationMissing.rawValue,
               "verification-missing reason should be verification_missing")
}

private func saveTaskDemotesUnverifiedAgentCompletedToAwaitingAudit() throws {
    let homeURL = temporaryDirectory()
    let store = AxiTodoStore(homeURL: homeURL)
    let task = try store.addTask(title: "Direct completed attempt", prompt: "Do work", cwd: homeURL.path, verifyCommand: "true")
    var edited = task
    edited.evidenceContract = "Need claim"
    edited.auditLevel = "strict"
    edited.evidenceMissing = true
    edited.status = .completed
    let saved = try store.saveTask(edited, note: "Internal bypass attempt")
    try expect(saved.status == .awaitingAudit,
               "Swift mirror gate should demote agent saveTask attempted .completed to .awaitingAudit")
}

private func updateStatusDemotesUnverifiedAgentCompletedToAwaitingAudit() throws {
    let homeURL = temporaryDirectory()
    let store = AxiTodoStore(homeURL: homeURL)
    let task = try store.addTask(title: "Status patch attempt", prompt: "Do work", cwd: homeURL.path, verifyCommand: "true")
    var seeded = task
    seeded.evidenceContract = "Need claim"
    seeded.auditLevel = "strict"
    seeded.evidenceMissing = true
    _ = try store.saveTask(seeded, note: "Seed gate fields")
    let demoted = try store.updateStatus(taskID: task.id, status: .completed)
    try expect(demoted.status == .awaitingAudit,
               "updateStatus(.completed) for unverified agent task should demote to .awaitingAudit")
}

private func personalCompletionStillPassesThroughGate() throws {
    let homeURL = temporaryDirectory()
    let store = AxiTodoStore(homeURL: homeURL)
    let task = try store.addTask(title: "Walk dog", prompt: "Quick walk", taskDomain: .personal, cwd: homeURL.path)
    let completed = try store.updateStatus(taskID: task.id, status: .completed)
    try expect(completed.status == .completed,
               "personal completion must stay independent of agent gate")
}

private func personalTasksStayOutOfTheAgentExecutionShape() throws {
    let homeURL = temporaryDirectory()
    let store = AxiTodoStore(homeURL: homeURL)
    let task = try store.addTask(
        title: "Buy milk",
        body: "On the way home",
        taskDomain: .personal,
        cwd: homeURL.path,
        dueAt: nil
    )

    try expect(task.taskDomain == .personal, "personal task should use personal domain")
    try expect(task.lifecycleStatus == .open, "personal task should start open")
    try expect(task.executionStatus == .idle, "personal task should not be queued")
    try expect(task.dueDate == nil, "personal task should allow no due date")
    try expect(task.dueAt == nil, "personal task should allow no due date")
    try expect(!(task.history.first?.id.isEmpty ?? true), "personal task history should have an id")
    try expect(task.history.first?.actor == "user", "personal task history should identify the user")

    let completed = try store.updateStatus(taskID: task.id, status: .completed)
    try expect(completed.lifecycleStatus == .completed, "personal completion should update lifecycle")
    try expect(completed.history.last?.event == "completed", "personal completion should record activity")

    let reopened = try store.updateStatus(taskID: task.id, status: .pending)
    try expect(reopened.lifecycleStatus == .open, "personal pending should reopen the task")
    try expect(reopened.history.last?.event == "reopened", "personal reopen should record activity")

    let snoozed = try store.snoozeTask(taskID: task.id)
    try expect(snoozed.reminderState == .snoozed, "personal snooze should update reminder state")
    try expect(snoozed.remindAt != nil, "personal snooze should set reminder time")
}

private func storeCreatesAndUpdatesTasksInNodeCompatibleShape() throws {
    let homeURL = temporaryDirectory()
    let store = AxiTodoStore(homeURL: homeURL)
    let dueAt = Date(timeIntervalSince1970: 1_800_000_000)

    let created = try store.addTask(
        title: "Desktop task",
        prompt: "Do the work",
        cwd: homeURL.path,
        priority: 4,
        maxAttempts: 2,
        dueAt: dueAt,
        verifyCommand: "true"
    )

    try expect(created.status == .pending, "created task should be pending")
    try expect(created.history.first?.event == "created", "created task should include history")

    let listed = try store.listTasks()
    try expect(listed.count == 1, "store should list one task")
    try expect(listed[0].title == "Desktop task", "stored title should round-trip")
    try expect(listed[0].verifyCommand == "true", "verify command should round-trip")

    var edited = listed[0]
    edited.status = .blocked
    edited.summary = "Needs a decision"
    let saved = try store.saveTask(edited)

    try expect(saved.status == .blocked, "edited status should be blocked")
    try expect(saved.summary == "Needs a decision", "summary should round-trip")
    try expect(saved.history.last?.event == "updated", "save should append update history")

    let data = try Data(contentsOf: store.fileURL)
    let object = try require(JSONSerialization.jsonObject(with: data) as? [String: Any], "store JSON should be an object")
    try expect(object["version"] as? Int == axiTodoStoreVersion, "store version should be preserved")
    let tasks = try require(object["tasks"] as? [[String: Any]], "store JSON should contain task array")
    try expect(tasks.first?["maxAttempts"] as? Int == 2, "maxAttempts should use Node field name")
    try expect(tasks.first?["verifyCommand"] as? String == "true", "verifyCommand should use Node field name")
}

private func storeDeletesTasksAndRejectsRunningDeletion() throws {
    let homeURL = temporaryDirectory()
    let store = AxiTodoStore(homeURL: homeURL)

    let pending = try store.addTask(title: "Delete me", prompt: "Remove this", cwd: homeURL.path)
    let deleted = try store.deleteTask(taskID: pending.id)

    try expect(deleted.id == pending.id, "deleted task should be returned")
    try expect(deleted.history.last?.event == "deleted", "deleted task should record history")
    let remaining = try store.listTasks()
    try expect(remaining.isEmpty, "deleted task should be removed from store")

    let running = try store.addTask(title: "Running", prompt: "Keep working", cwd: homeURL.path)
    var claimed = running
    claimed.status = .running
    _ = try store.saveTask(claimed)

    do {
        _ = try store.deleteTask(taskID: running.id)
        try expect(false, "running task deletion should fail")
    } catch let error as AxiTodoStoreError {
        try expect(error == .runningTaskCannotBeDeleted(running.id), "running task deletion should be blocked")
    }
}

private func storeReadsMixedHistoryDataWrittenByRunner() throws {
    let homeURL = temporaryDirectory()
    let fileURL = homeURL.appendingPathComponent("tasks.json")
    try FileManager.default.createDirectory(at: homeURL, withIntermediateDirectories: true)
    try """
    {
      "version": 1,
      "tasks": [
        {
          "id": "task-1",
          "title": "Runner task",
          "prompt": "Run it",
          "cwd": "\(homeURL.path)",
          "status": "completed",
          "priority": 0,
          "attempts": 1,
          "maxAttempts": 3,
          "dueAt": "2026-05-26T00:00:00.000Z",
          "createdAt": "2026-05-26T00:00:00.000Z",
          "updatedAt": "2026-05-26T00:01:00.000Z",
          "verification": {"status": "passed", "exitCode": 0},
          "history": [
            {
              "at": "2026-05-26T00:01:00.000Z",
              "event": "completed",
              "message": "Task completed",
              "data": {"success": true, "exitCode": 0, "verification": {"status": "passed"}}
            }
          ]
        }
      ]
    }
    """.write(to: fileURL, atomically: true, encoding: .utf8)

    let tasks = try AxiTodoStore(homeURL: homeURL).listTasks()

    try expect(tasks.count == 1, "runner fixture should decode one task")
    try expect(tasks[0].status == .completed, "runner fixture status should decode")
    try expect(tasks[0].history.count == 1, "mixed history data should decode")
    try expect(tasks[0].history[0].id.hasPrefix("legacy-"), "legacy history should get a stable id")
}

private func statusUpdateCanRequeueFailedTask() throws {
    let homeURL = temporaryDirectory()
    let store = AxiTodoStore(homeURL: homeURL)
    let task = try store.addTask(title: "Retry", prompt: "Try again", cwd: homeURL.path)
    var failed = task
    failed.status = .failed
    failed.error = "Nope"
    _ = try store.saveTask(failed)

    let updated = try store.updateStatus(taskID: task.id, status: .pending)

    try expect(updated.status == .pending, "status update should requeue")
    try expect(updated.error == nil, "requeue should clear error")
    try expect(updated.history.last?.event == "status_updated", "status update should append history")
}

private func storeReadsImportedPostgresProvenanceFieldsFromJSON() throws {
    let homeURL = temporaryDirectory()
    let fileURL = homeURL.appendingPathComponent("tasks.json")
    try FileManager.default.createDirectory(at: homeURL, withIntermediateDirectories: true)
    try """
    {
      "version": 1,
      "tasks": [
        {
          "id": "imported-1",
          "title": "Imported from PG",
          "prompt": "Resolve escalation",
          "cwd": "\(homeURL.path)",
          "status": "pending",
          "priority": 0,
          "attempts": 0,
          "maxAttempts": 3,
          "dueAt": "2026-10-01T00:00:00.000Z",
          "createdAt": "2026-10-01T00:00:00.000Z",
          "updatedAt": "2026-10-01T00:00:00.000Z",
          "source": "import-postgres",
          "importedAt": "2026-10-01T00:00:00Z"
        }
      ]
    }
    """.write(to: fileURL, atomically: true, encoding: .utf8)

    let tasks = try AxiTodoStore(homeURL: homeURL).listTasks()

    try expect(tasks.count == 1, "M6 track-2: importer fixture should decode one task")
    try expect(tasks[0].source == "import-postgres",
               "M6 track-2: source should decode from top-level JSON field")
    let importedAt = try require(tasks[0].importedAt, "M6 track-2: importedAt should decode as a Date when present")
    // ISO 8601 strings with or without fractional seconds should both parse.
    try expect(importedAt == Date(timeIntervalSince1970: 1_790_812_800),
               "M6 track-2: importedAt should round-trip to 2026-10-01T00:00:00Z")
}

private func storeReadsNativeTasksWithNilProvenanceFields() throws {
    let homeURL = temporaryDirectory()
    let fileURL = homeURL.appendingPathComponent("tasks.json")
    try FileManager.default.createDirectory(at: homeURL, withIntermediateDirectories: true)
    // Older JSON files (pre-provenance, npm data, or native runner output)
    // never had these fields. The Swift bridge must decode them cleanly with
    // `nil` provenance so the desktop stays backward-compatible.
    try """
    {
      "version": 1,
      "tasks": [
        {
          "id": "native-1",
          "title": "Native task",
          "prompt": "Run native flow",
          "cwd": "\(homeURL.path)",
          "status": "pending",
          "priority": 0,
          "attempts": 0,
          "maxAttempts": 3,
          "dueAt": "2026-10-01T00:00:00.000Z",
          "createdAt": "2026-10-01T00:00:00.000Z",
          "updatedAt": "2026-10-01T00:00:00.000Z"
        }
      ]
    }
    """.write(to: fileURL, atomically: true, encoding: .utf8)

    let tasks = try AxiTodoStore(homeURL: homeURL).listTasks()

    try expect(tasks.count == 1, "M6 track-2: native fixture should decode one task")
    try expect(tasks[0].source == nil,
               "M6 track-2: missing source should decode as nil for native tasks")
    try expect(tasks[0].importedAt == nil,
               "M6 track-2: missing importedAt should decode as nil for native tasks")
}

private func storeRoundTripsProvenanceFieldsThroughReencode() throws {
    let homeURL = temporaryDirectory()
    let fileURL = homeURL.appendingPathComponent("tasks.json")
    try FileManager.default.createDirectory(at: homeURL, withIntermediateDirectories: true)
    // Seed JSON that mirrors what the PG importer writes via lib/schema.mjs
    // `normalizeExistingTask`: source/importedAt are lifted to the top level
    // (not buried inside a nested `payload` envelope).
    try """
    {
      "version": 1,
      "tasks": [
        {
          "id": "imported-2",
          "title": "Imported via reencode",
          "prompt": "Resolve",
          "cwd": "\(homeURL.path)",
          "status": "pending",
          "priority": 0,
          "attempts": 0,
          "maxAttempts": 3,
          "dueAt": "2026-10-01T00:00:00.000Z",
          "createdAt": "2026-10-01T00:00:00.000Z",
          "updatedAt": "2026-10-01T00:00:00.000Z",
          "source": "import-postgres",
          "importedAt": "2026-10-02T00:00:00Z"
        }
      ]
    }
    """.write(to: fileURL, atomically: true, encoding: .utf8)

    let store = AxiTodoStore(homeURL: homeURL)
    let reloaded = try store.listTasks()
    let imported = try require(reloaded.first(where: { $0.id == "imported-2" }),
                               "M6 track-2: reloaded store should contain imported-2")
    try expect(imported.source == "import-postgres",
               "M6 track-2: reloaded imported task should keep its top-level source")
    try expect(imported.importedAt == Date(timeIntervalSince1970: 1_790_899_200),
               "M6 track-2: reloaded imported task should keep its top-level importedAt")

    // Encode the imported task back through the bridge and confirm the
    // provenance fields land at the **top level** of the JSON, not nested
    // inside a `payload` envelope. The Swift desktop reads JSON directly,
    // so the JSON side and the Swift side must agree on the same top-level
    // shape that lib/schema.mjs produces.
    var saved = imported
    saved.title = "Importer-renamed"
    _ = try store.saveTask(saved, note: "M6 track-2 re-encode check")
    let encodedData = try Data(contentsOf: store.fileURL)
    let encodedObject = try require(JSONSerialization.jsonObject(with: encodedData) as? [String: Any],
                                    "M6 track-2: encoded JSON should be an object")
    let encodedTasks = try require(encodedObject["tasks"] as? [[String: Any]],
                                   "M6 track-2: encoded JSON should contain task array")
    let encodedImported = try require(encodedTasks.first(where: { ($0["id"] as? String) == "imported-2" }),
                                      "M6 track-2: encoded JSON should contain imported-2")
    try expect(encodedImported["source"] as? String == "import-postgres",
               "M6 track-2: re-encode should keep source at top level after saveTask")
    try expect(encodedImported["importedAt"] as? String == "2026-10-02T00:00:00Z",
               "M6 track-2: re-encode should keep importedAt at top level after saveTask")
    try expect(encodedImported["payload"] == nil,
               "M6 track-2: provenance fields must not be re-nested under payload")

    // A native task added through the API should round-trip with `source`
    // absent (Swift does not synthesise "native" — the canonical default in
    // lib/schema.mjs is `null` / missing key).
    let native = try store.addTask(title: "Native round-trip", prompt: "Do it", cwd: homeURL.path)
    let nativeData = try Data(contentsOf: store.fileURL)
    let nativeObject = try require(JSONSerialization.jsonObject(with: nativeData) as? [String: Any],
                                   "M6 track-2: native re-encode JSON should be an object")
    let nativeTasks = try require(nativeObject["tasks"] as? [[String: Any]],
                                  "M6 track-2: native re-encode JSON should contain task array")
    let encodedNative = try require(nativeTasks.first(where: { ($0["id"] as? String) == native.id }),
                                    "M6 track-2: native re-encode JSON should contain native task")
    try expect(encodedNative["source"] == nil,
               "M6 track-2: native re-encode should omit source at top level")
    try expect(encodedNative["importedAt"] == nil,
               "M6 track-2: native re-encode should omit importedAt at top level")
}

private func temporaryDirectory() -> URL {
    URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("axi-todo-desktop-tests-\(UUID().uuidString)", isDirectory: true)
}

private func expect(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    if !condition() {
        throw SmokeTestError.failed(message)
    }
}

private func require<T>(_ value: T?, _ message: String) throws -> T {
    guard let value else {
        throw SmokeTestError.failed(message)
    }
    return value
}

private enum SmokeTestError: LocalizedError {
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .failed(let message):
            return message
        }
    }
}
