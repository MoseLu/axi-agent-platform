import AxiTodoKit
import Foundation

try runStoreSmokeTests()

private func runStoreSmokeTests() throws {
    try storeCreatesAndUpdatesTasksInNodeCompatibleShape()
    try storeReadsMixedHistoryDataWrittenByRunner()
    try personalTasksStayOutOfTheAgentExecutionShape()
    try storeDeletesTasksAndRejectsRunningDeletion()
    try statusUpdateCanRequeueFailedTask()
    print("AxiTodoStoreSmokeTests passed")
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
