import Darwin
import Foundation

public final class AxiTodoStore {
    public let homeURL: URL
    public let fileURL: URL
    private let lockURL: URL
    private let lockRetryMicros: useconds_t = 50_000
    private let lockTimeoutSeconds: TimeInterval = 5

    public init(homeURL: URL = AxiTodoStore.defaultHomeURL(), fileURL: URL? = nil) {
        self.homeURL = homeURL.standardizedFileURL
        self.fileURL = (fileURL ?? homeURL.appendingPathComponent("tasks.json")).standardizedFileURL
        self.lockURL = URL(fileURLWithPath: self.fileURL.path + ".lock")
    }

    public static func defaultHomeURL(environment: [String: String] = ProcessInfo.processInfo.environment) -> URL {
        if let customHome = environment["AXI_TODO_HOME"]?.trimmedNonEmpty {
            return URL(fileURLWithPath: customHome).standardizedFileURL
        }
        return URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".axi-todo", isDirectory: true)
    }

    public func readState() throws -> AxiTodoState {
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            return AxiTodoState()
        }
        let data = try Data(contentsOf: fileURL)
        let decoder = JSONDecoder()
        return try decoder.decode(AxiTodoState.self, from: data)
    }

    public func listTasks() throws -> [AxiTodoTask] {
        try readState().tasks.sorted(by: taskSort)
    }

    @discardableResult
    public func addTask(
        title: String,
        prompt: String,
        cwd: String,
        priority: Int = 0,
        maxAttempts: Int = 3,
        dueAt: Date = Date(),
        verifyCommand: String? = nil
    ) throws -> AxiTodoTask {
        try mutate { state in
            let task = AxiTodoTask.create(
                title: title,
                prompt: prompt,
                cwd: cwd,
                priority: priority,
                maxAttempts: maxAttempts,
                dueAt: dueAt,
                verifyCommand: verifyCommand
            )
            state.tasks.append(task)
            return task
        }
    }

    @discardableResult
    public func saveTask(_ editedTask: AxiTodoTask, note: String = "Task updated") throws -> AxiTodoTask {
        try mutate { state in
            guard let index = state.tasks.firstIndex(where: { $0.id == editedTask.id }) else {
                throw AxiTodoStoreError.unknownTask(editedTask.id)
            }

            var task = editedTask
            let now = AxiTodoDate.isoString()
            task.title = task.title.trimmedNonEmpty ?? "Untitled"
            task.prompt = task.prompt.trimmedNonEmpty ?? task.title
            task.cwd = URL(fileURLWithPath: task.cwd).standardizedFileURL.path
            task.verifyCommand = task.verifyCommand?.trimmedNonEmpty
            task.priority = min(100, max(-100, task.priority))
            task.maxAttempts = max(1, task.maxAttempts)
            task.updatedAt = now

            if task.status == .completed {
                task.completedAt = task.completedAt ?? now
                task.error = nil
            }
            if task.status != .completed {
                task.completedAt = nil
            }

            task.appendHistory(event: "updated", message: note, at: now)
            state.tasks[index] = task
            return task
        }
    }

    @discardableResult
    public func deleteTask(taskID: String) throws -> AxiTodoTask {
        try mutate { state in
            guard let index = state.tasks.firstIndex(where: { $0.id == taskID }) else {
                throw AxiTodoStoreError.unknownTask(taskID)
            }
            guard state.tasks[index].status != .running else {
                throw AxiTodoStoreError.runningTaskCannotBeDeleted(taskID)
            }

            let now = AxiTodoDate.isoString()
            var task = state.tasks.remove(at: index)
            task.updatedAt = now
            task.appendHistory(event: "deleted", message: "Task deleted", at: now)
            return task
        }
    }

    @discardableResult
    public func updateStatus(taskID: String, status: AxiTaskStatus) throws -> AxiTodoTask {
        try mutate { state in
            guard let index = state.tasks.firstIndex(where: { $0.id == taskID }) else {
                throw AxiTodoStoreError.unknownTask(taskID)
            }
            let now = AxiTodoDate.isoString()
            state.tasks[index].status = status
            state.tasks[index].updatedAt = now
            state.tasks[index].error = [.pending, .completed].contains(status) ? nil : state.tasks[index].error
            state.tasks[index].completedAt = status == .completed ? (state.tasks[index].completedAt ?? now) : nil
            state.tasks[index].appendHistory(
                event: "status_updated",
                message: "Task status updated",
                data: ["status": .string(status.rawValue)],
                at: now
            )
            return state.tasks[index]
        }
    }

    private func mutate<T>(_ operation: (inout AxiTodoState) throws -> T) throws -> T {
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )

        return try withFileLock {
            var state = try readState()
            let result = try operation(&state)
            state.version = axiTodoStoreVersion
            try writeState(state)
            return result
        }
    }

    private func writeState(_ state: AxiTodoState) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(state)
        try data.write(to: fileURL, options: [.atomic])
    }

    private func withFileLock<T>(_ operation: () throws -> T) throws -> T {
        let startedAt = Date()
        var fd: Int32 = -1
        while fd == -1 {
            fd = Darwin.open(lockURL.path, O_CREAT | O_EXCL | O_WRONLY, S_IRUSR | S_IWUSR | S_IRGRP | S_IROTH)
            if fd == -1 {
                if Date().timeIntervalSince(startedAt) > lockTimeoutSeconds {
                    throw AxiTodoStoreError.lockTimeout(lockURL.path)
                }
                usleep(lockRetryMicros)
            }
        }

        let payload = #"{"pid":\#(getpid()),"at":"\#(AxiTodoDate.isoString())"}"#
        _ = payload.withCString { Darwin.write(fd, $0, strlen($0)) }
        Darwin.close(fd)

        defer {
            try? FileManager.default.removeItem(at: lockURL)
        }

        return try operation()
    }
}

public enum AxiTodoStoreError: LocalizedError, Equatable {
    case lockTimeout(String)
    case unknownTask(String)
    case runningTaskCannotBeDeleted(String)

    public var errorDescription: String? {
        switch self {
        case .lockTimeout(let path):
            "Timed out waiting for store lock: \(path)"
        case .unknownTask(let id):
            "Unknown task: \(id)"
        case .runningTaskCannotBeDeleted(let id):
            "Cannot delete running task: \(id)"
        }
    }
}

private func taskSort(left: AxiTodoTask, right: AxiTodoTask) -> Bool {
    if left.priority != right.priority {
        return left.priority > right.priority
    }
    return left.createdAt < right.createdAt
}
