import Foundation

public let axiTodoStoreVersion = 3

public enum AxiTaskDomain: String, Codable, CaseIterable, Identifiable {
    case agent
    case personal

    public var id: String { rawValue }
}

public enum AxiTodoLifecycleStatus: String, Codable, CaseIterable, Identifiable {
    case open
    case completed
    case cancelled
    case archived

    public var id: String { rawValue }
}

public enum AxiTodoExecutionStatus: String, Codable, CaseIterable, Identifiable {
    case idle
    case queued
    case running
    case succeeded
    case failed
    case blocked

    public var id: String { rawValue }
}

public enum AxiTodoReminderState: String, Codable, CaseIterable, Identifiable {
    case none
    case scheduled
    case snoozed
    case fired
    case cancelled

    public var id: String { rawValue }
}

public enum AxiTaskStatus: String, Codable, CaseIterable, Identifiable {
    case pending
    case running
    case completed
    case failed
    case blocked
    case cancelled

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .pending: "待处理"
        case .running: "运行中"
        case .completed: "已完成"
        case .failed: "失败"
        case .blocked: "阻塞"
        case .cancelled: "已取消"
        }
    }
}

public struct AxiTodoState: Codable, Equatable {
    public var version: Int
    public var tasks: [AxiTodoTask]

    public init(version: Int = axiTodoStoreVersion, tasks: [AxiTodoTask] = []) {
        self.version = version
        self.tasks = tasks
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = axiTodoStoreVersion
        tasks = try container.decodeIfPresent([AxiTodoTask].self, forKey: .tasks) ?? []
    }
}

public struct AxiTodoTask: Codable, Equatable, Identifiable {
    public var id: String
    public var title: String
    public var prompt: String
    public var body: String?
    public var taskDomain: AxiTaskDomain
    public var lifecycleStatus: AxiTodoLifecycleStatus
    public var executionStatus: AxiTodoExecutionStatus
    public var cwd: String
    public var status: AxiTaskStatus
    public var priority: Int
    public var attempts: Int
    public var maxAttempts: Int
    public var dueDate: String?
    public var dueAt: String?
    public var remindAt: String?
    public var reminderState: AxiTodoReminderState
    public var verifyCommand: String?
    public var summary: String?
    public var error: String?
    public var createdAt: String
    public var updatedAt: String
    public var startedAt: String?
    public var completedAt: String?
    public var lastRunId: String?
    public var lastOutputPath: String?
    public var verification: AxiTodoVerification
    public var verifyLoggedAt: String?
    public var history: [AxiTodoHistoryEntry]

    public init(
        id: String = UUID().uuidString.lowercased(),
        title: String,
        prompt: String,
        body: String? = nil,
        taskDomain: AxiTaskDomain = .agent,
        lifecycleStatus: AxiTodoLifecycleStatus = .open,
        executionStatus: AxiTodoExecutionStatus = .idle,
        cwd: String,
        status: AxiTaskStatus = .pending,
        priority: Int = 0,
        attempts: Int = 0,
        maxAttempts: Int = 3,
        dueDate: String? = nil,
        dueAt: String? = nil,
        remindAt: String? = nil,
        reminderState: AxiTodoReminderState = .none,
        verifyCommand: String? = nil,
        summary: String? = nil,
        error: String? = nil,
        createdAt: String,
        updatedAt: String,
        startedAt: String? = nil,
        completedAt: String? = nil,
        lastRunId: String? = nil,
        lastOutputPath: String? = nil,
        verification: AxiTodoVerification = AxiTodoVerification(),
        verifyLoggedAt: String? = nil,
        history: [AxiTodoHistoryEntry] = []
    ) {
        self.id = id
        self.title = title
        self.prompt = prompt
        self.body = body
        self.taskDomain = taskDomain
        self.lifecycleStatus = lifecycleStatus
        self.executionStatus = executionStatus
        self.cwd = cwd
        self.status = status
        self.priority = min(100, max(-100, priority))
        self.attempts = max(0, attempts)
        self.maxAttempts = max(1, maxAttempts)
        self.dueDate = dueDate
        self.dueAt = dueAt
        self.remindAt = remindAt
        self.reminderState = reminderState
        self.verifyCommand = verifyCommand
        self.summary = summary
        self.error = error
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.startedAt = startedAt
        self.completedAt = completedAt
        self.lastRunId = lastRunId
        self.lastOutputPath = lastOutputPath
        self.verification = verification
        self.verifyLoggedAt = verifyLoggedAt
        self.history = Array(history.suffix(100))
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let now = AxiTodoDate.isoString()

        id = try container.decodeTrimmedString(forKey: .id, fallback: UUID().uuidString.lowercased())
        title = try container.decodeTrimmedString(forKey: .title, fallback: "Untitled")
        prompt = try container.decodeTrimmedString(forKey: .prompt, fallback: title)
        body = try container.decodeOptionalTrimmedString(forKey: .body)
        let domainText = try container.decodeTrimmedString(forKey: .taskDomain, fallback: AxiTaskDomain.agent.rawValue)
        taskDomain = AxiTaskDomain(rawValue: domainText) ?? .agent
        cwd = try container.decodeTrimmedString(forKey: .cwd, fallback: FileManager.default.currentDirectoryPath)
        let statusText = try container.decodeTrimmedString(forKey: .status, fallback: AxiTaskStatus.pending.rawValue)
        status = AxiTaskStatus(rawValue: statusText) ?? .pending
        let lifecycleText = try container.decodeTrimmedString(
            forKey: .lifecycleStatus,
            fallback: status == .completed ? AxiTodoLifecycleStatus.completed.rawValue : status == .cancelled ? AxiTodoLifecycleStatus.cancelled.rawValue : AxiTodoLifecycleStatus.open.rawValue
        )
        lifecycleStatus = AxiTodoLifecycleStatus(rawValue: lifecycleText) ?? .open
        let executionText = try container.decodeTrimmedString(
            forKey: .executionStatus,
            fallback: AxiTodoExecutionStatus.from(status: status, domain: taskDomain).rawValue
        )
        executionStatus = AxiTodoExecutionStatus(rawValue: executionText) ?? .idle
        priority = min(100, max(-100, try container.decodeIfPresent(Int.self, forKey: .priority) ?? 0))
        attempts = max(0, try container.decodeIfPresent(Int.self, forKey: .attempts) ?? 0)
        maxAttempts = max(1, try container.decodeIfPresent(Int.self, forKey: .maxAttempts) ?? 3)
        dueDate = try container.decodeOptionalTrimmedString(forKey: .dueDate)
        let normalizedDueAt = AxiTodoDate.normalizedIsoString(try container.decodeIfPresent(String.self, forKey: .dueAt))
        // Preserve the v1 Agent default while allowing personal tasks to have
        // no schedule at all.
        dueAt = normalizedDueAt ?? (taskDomain == .agent ? now : nil)
        if dueDate == nil, taskDomain == .personal, let dueAt {
            dueDate = String(dueAt.prefix(10))
        }
        remindAt = AxiTodoDate.normalizedIsoString(try container.decodeIfPresent(String.self, forKey: .remindAt))
        let reminderText = try container.decodeTrimmedString(
            forKey: .reminderState,
            fallback: remindAt == nil ? AxiTodoReminderState.none.rawValue : AxiTodoReminderState.scheduled.rawValue
        )
        reminderState = AxiTodoReminderState(rawValue: reminderText) ?? .none
        verifyCommand = try container.decodeOptionalTrimmedString(forKey: .verifyCommand)
        summary = try container.decodeOptionalTrimmedString(forKey: .summary)
        error = try container.decodeOptionalTrimmedString(forKey: .error)
        createdAt = AxiTodoDate.normalizedIsoString(try container.decodeIfPresent(String.self, forKey: .createdAt)) ?? now
        updatedAt = AxiTodoDate.normalizedIsoString(try container.decodeIfPresent(String.self, forKey: .updatedAt)) ?? now
        startedAt = AxiTodoDate.normalizedIsoString(try container.decodeIfPresent(String.self, forKey: .startedAt))
        completedAt = AxiTodoDate.normalizedIsoString(try container.decodeIfPresent(String.self, forKey: .completedAt))
        lastRunId = try container.decodeOptionalTrimmedString(forKey: .lastRunId)
        lastOutputPath = try container.decodeOptionalTrimmedString(forKey: .lastOutputPath)
        verification = try container.decodeIfPresent(AxiTodoVerification.self, forKey: .verification) ?? AxiTodoVerification()
        verifyLoggedAt = try container.decodeOptionalTrimmedString(forKey: .verifyLoggedAt)
        history = Array((try container.decodeIfPresent([AxiTodoHistoryEntry].self, forKey: .history) ?? []).suffix(100))
    }

    public static func create(
        title: String,
        prompt: String? = nil,
        body: String? = nil,
        taskDomain: AxiTaskDomain = .agent,
        cwd: String,
        priority: Int,
        maxAttempts: Int,
        dueDate: String? = nil,
        dueAt: Date? = nil,
        remindAt: Date? = nil,
        verifyCommand: String? = nil
    ) -> AxiTodoTask {
        let now = AxiTodoDate.isoString()
        var task = AxiTodoTask(
            title: title.trimmedNonEmpty ?? "Untitled",
            prompt: prompt?.trimmedNonEmpty ?? title.trimmedNonEmpty ?? "Untitled",
            body: body?.trimmedNonEmpty,
            taskDomain: taskDomain,
            lifecycleStatus: .open,
            executionStatus: taskDomain == .personal ? .idle : .queued,
            cwd: URL(fileURLWithPath: cwd).standardizedFileURL.path,
            priority: priority,
            maxAttempts: maxAttempts,
            dueDate: dueDate ?? (taskDomain == .personal ? dueAt.map { AxiTodoDate.dateOnlyString(from: $0) } : nil),
            dueAt: dueAt.map { AxiTodoDate.isoString(from: $0) },
            remindAt: remindAt.map { AxiTodoDate.isoString(from: $0) },
            reminderState: remindAt == nil ? .none : .scheduled,
            verifyCommand: verifyCommand?.trimmedNonEmpty,
            createdAt: now,
            updatedAt: now
        )
        task.appendHistory(event: "created", message: "Task created", actor: taskDomain == .personal ? "user" : "system", at: now)
        return task
    }

    public mutating func appendHistory(
        event: String,
        message: String,
        data: [String: AxiTodoJSONValue] = [:],
        actor: String = "system",
        at: String = AxiTodoDate.isoString()
    ) {
        history.append(AxiTodoHistoryEntry(at: at, event: event, actor: actor, message: message, data: data))
        if history.count > 100 {
            history = Array(history.suffix(100))
        }
    }
}

extension AxiTodoExecutionStatus {
    public static func from(status: AxiTaskStatus, domain: AxiTaskDomain) -> AxiTodoExecutionStatus {
        if domain == .personal { return .idle }
        switch status {
        case .pending: return .queued
        case .running: return .running
        case .completed: return .succeeded
        case .failed: return .failed
        case .blocked: return .blocked
        case .cancelled: return .idle
        }
    }
}

public struct AxiTodoVerification: Codable, Equatable {
    public var status: String?
    public var checkedAt: String?
    public var exitCode: Int?
    public var output: String?

    public init(status: String? = nil, checkedAt: String? = nil, exitCode: Int? = nil, output: String? = nil) {
        self.status = status
        self.checkedAt = checkedAt
        self.exitCode = exitCode
        self.output = output
    }
}

public struct AxiTodoHistoryEntry: Codable, Equatable, Identifiable {
    public var id: String
    public var at: String
    public var event: String
    public var actor: String
    public var message: String
    public var data: [String: AxiTodoJSONValue]

    public init(id: String = UUID().uuidString.lowercased(), at: String, event: String, actor: String = "system", message: String, data: [String: AxiTodoJSONValue] = [:]) {
        self.id = id
        self.at = at
        self.event = event
        self.actor = actor
        self.message = message
        self.data = data
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        at = try container.decodeTrimmedString(forKey: .at, fallback: AxiTodoDate.isoString())
        event = try container.decodeTrimmedString(forKey: .event, fallback: "event")
        actor = try container.decodeTrimmedString(forKey: .actor, fallback: "system")
        message = try container.decodeTrimmedString(forKey: .message, fallback: "")
        id = try container.decodeTrimmedString(forKey: .id, fallback: "legacy-\(at)-\(event)-\(message)")
        data = try container.decodeIfPresent([String: AxiTodoJSONValue].self, forKey: .data) ?? [:]
    }
}

public enum AxiTodoJSONValue: Codable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: AxiTodoJSONValue])
    case array([AxiTodoJSONValue])
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([AxiTodoJSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: AxiTodoJSONValue].self))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }
}

public enum AxiTodoDate {
    public static func isoString(from date: Date = Date()) -> String {
        makeFormatter(includeFractionalSeconds: true).string(from: date)
    }

    public static func normalizedIsoString(_ text: String?) -> String? {
        guard let date = parse(text) else { return nil }
        return isoString(from: date)
    }

    public static func dateOnlyString(from date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    public static func parse(_ text: String?) -> Date? {
        guard let text = text?.trimmedNonEmpty else { return nil }
        for formatter in [
            makeFormatter(includeFractionalSeconds: true),
            makeFormatter(includeFractionalSeconds: false),
        ] {
            if let date = formatter.date(from: text) {
                return date
            }
        }
        return nil
    }

    private static func makeFormatter(includeFractionalSeconds: Bool) -> ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = includeFractionalSeconds
            ? [.withInternetDateTime, .withFractionalSeconds]
            : [.withInternetDateTime]
        return formatter
    }
}

extension String {
    public var trimmedNonEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    public var matchesDateOnlyFormat: Bool {
        range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil
    }
}

private extension KeyedDecodingContainer {
    func decodeTrimmedString(forKey key: Key, fallback: String) throws -> String {
        try decodeIfPresent(String.self, forKey: key)?.trimmedNonEmpty ?? fallback
    }

    func decodeOptionalTrimmedString(forKey key: Key) throws -> String? {
        try decodeIfPresent(String.self, forKey: key)?.trimmedNonEmpty
    }
}
