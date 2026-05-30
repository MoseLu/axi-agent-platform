import AppKit
import AxiTodoKit
import Foundation
import WebKit

@main
final class AxiTodoDesktopApp: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var webView: WKWebView!
    private let store = AxiTodoStore()

    static func main() {
        let app = NSApplication.shared
        let delegate = AxiTodoDesktopApp()
        app.delegate = delegate
        app.run()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)

        let configuration = WKWebViewConfiguration()
        configuration.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        configuration.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
        configuration.userContentController.add(self, name: "axiTodoNative")

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1180, height: 680),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Axi Todo"
        window.center()
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)

        loadWebApp()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showLoadError(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showLoadError(error)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "axiTodoNative",
              let body = message.body as? [String: Any],
              let requestId = body["id"] as? String,
              let method = body["method"] as? String else {
            return
        }

        do {
            let payload = body["payload"] as? [String: Any] ?? [:]
            let result = try handle(method: method, payload: payload)
            sendResponse(id: requestId, result: result)
        } catch {
            sendResponse(id: requestId, error: error.localizedDescription)
        }
    }

    private func loadWebApp() {
        if let bundleURL = Bundle.main.resourceURL?.appendingPathComponent("web/index.html"),
           FileManager.default.fileExists(atPath: bundleURL.path) {
            webView.loadFileURL(bundleURL, allowingReadAccessTo: bundleURL.deletingLastPathComponent())
            return
        }

        let fallbackURL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent("dist-web/index.html")
        if FileManager.default.fileExists(atPath: fallbackURL.path) {
            webView.loadFileURL(fallbackURL, allowingReadAccessTo: fallbackURL.deletingLastPathComponent())
            return
        }

        webView.loadHTMLString(
            """
            <!doctype html><meta charset="utf-8">
            <body style="font:14px -apple-system;padding:24px">
              <h2>Axi Todo</h2>
              <p>Web UI is missing. Run <code>pnpm frontend:build</code> before opening the desktop app.</p>
            </body>
            """,
            baseURL: nil
        )
    }

    private func showLoadError(_ error: Error) {
        let message = htmlEscape(error.localizedDescription)
        webView.loadHTMLString(
            """
            <!doctype html><meta charset="utf-8">
            <body style="box-sizing:border-box;margin:0;min-height:100vh;padding:24px;font:13px ui-monospace,SFMono-Regular,Menlo,monospace;color:#991b1b;background:#fff7f7;white-space:pre-wrap">
            Axi Todo UI failed to load

            \(message)
            </body>
            """,
            baseURL: nil
        )
    }

    private func handle(method: String, payload: [String: Any]) throws -> Any {
        switch method {
        case "listTasks":
            return [
                "storePath": store.fileURL.path,
                "tasks": try jsonObject(store.listTasks()),
            ]
        case "listWorkspaceProjects":
            return ["projects": workspaceProjects()]
        case "createTask":
            return try jsonObject(store.addTask(
                title: string(payload["title"]) ?? "新 Todo",
                prompt: string(payload["prompt"]) ?? "待填写",
                cwd: string(payload["cwd"]) ?? defaultWorkspacePath(),
                priority: int(payload["priority"]) ?? 0,
                maxAttempts: int(payload["maxAttempts"]) ?? 3,
                dueAt: AxiTodoDate.parse(string(payload["dueAt"])) ?? Date(),
                verifyCommand: string(payload["verifyCommand"])
            ))
        case "saveTask":
            let task = try decode(AxiTodoTask.self, from: require(payload["task"], "task"))
            return try jsonObject(store.saveTask(task, note: "Task updated from desktop table"))
        case "deleteTask":
            let id = try requireString(payload["id"], "id")
            return try jsonObject(store.deleteTask(taskID: id))
        case "updateStatus":
            let id = try requireString(payload["id"], "id")
            let statusText = try requireString(payload["status"], "status")
            guard let status = AxiTaskStatus(rawValue: statusText) else {
                throw BridgeError.invalidPayload("invalid status: \(statusText)")
            }
            return try jsonObject(store.updateStatus(taskID: id, status: status))
        default:
            throw BridgeError.invalidPayload("unknown method: \(method)")
        }
    }

    private func sendResponse(id: String, result: Any? = nil, error: String? = nil) {
        let response: [String: Any] = [
            "id": id,
            "result": result ?? NSNull(),
            "error": error ?? NSNull(),
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: response),
              let json = String(data: data, encoding: .utf8) else {
            return
        }
        webView.evaluateJavaScript("window.__axiTodoResolve(\(json));")
    }

    private func jsonObject<T: Encodable>(_ value: T) throws -> Any {
        let data = try JSONEncoder().encode(value)
        return try JSONSerialization.jsonObject(with: data)
    }

    private func decode<T: Decodable>(_ type: T.Type, from object: Any) throws -> T {
        let data = try JSONSerialization.data(withJSONObject: object)
        return try JSONDecoder().decode(type, from: data)
    }

    private func require(_ value: Any?, _ name: String) throws -> Any {
        guard let value else {
            throw BridgeError.invalidPayload("\(name) is required")
        }
        return value
    }

    private func requireString(_ value: Any?, _ name: String) throws -> String {
        guard let text = string(value) else {
            throw BridgeError.invalidPayload("\(name) is required")
        }
        return text
    }

    private func string(_ value: Any?) -> String? {
        guard let value else { return nil }
        let text = String(describing: value).trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text
    }

    private func int(_ value: Any?) -> Int? {
        if let number = value as? NSNumber {
            return number.intValue
        }
        if let text = value as? String {
            return Int(text)
        }
        return nil
    }

    private func defaultWorkspacePath() -> String {
        let workspace = "/Volumes/code/workspace"
        return FileManager.default.fileExists(atPath: workspace) ? workspace : NSHomeDirectory()
    }

    private func workspaceProjects() -> [[String: String]] {
        let workspace = defaultWorkspacePath()
        var projects = [WorkspaceProjectChoice(label: "workspace", path: workspace)]

        let indexURL = URL(fileURLWithPath: workspace).appendingPathComponent("WORKSPACE_INDEX.md")
        if let index = try? String(contentsOf: indexURL, encoding: .utf8) {
            projects.append(contentsOf: parseWorkspaceIndex(index, workspace: workspace))
        }

        if projects.count == 1 {
            projects.append(contentsOf: discoverWorkspaceDirectories(workspace: workspace))
        }

        var seen = Set<String>()
        let unique = projects.filter { project in
            guard !seen.contains(project.path) else { return false }
            seen.insert(project.path)
            return true
        }.sorted { left, right in
            if left.path == workspace { return true }
            if right.path == workspace { return false }
            return left.label.localizedCaseInsensitiveCompare(right.label) == .orderedAscending
        }

        return unique.map { ["label": $0.label, "path": $0.path] }
    }

    private func parseWorkspaceIndex(_ index: String, workspace: String) -> [WorkspaceProjectChoice] {
        index.split(separator: "\n").compactMap { rawLine in
            let line = String(rawLine)
            guard line.hasPrefix("|") else { return nil }
            let cells = line.split(separator: "|", omittingEmptySubsequences: false)
                .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            guard cells.count > 3,
                  let path = firstBacktickValue(in: cells[2]),
                  path.hasPrefix(workspace),
                  FileManager.default.fileExists(atPath: path) else {
                return nil
            }
            return WorkspaceProjectChoice(label: stripMarkdown(cells[1]), path: path)
        }
    }

    private func discoverWorkspaceDirectories(workspace: String) -> [WorkspaceProjectChoice] {
        let partitions = ["projects", "products", "tools", "infra", "shared"]
        return partitions.flatMap { partition -> [WorkspaceProjectChoice] in
            let partitionURL = URL(fileURLWithPath: workspace).appendingPathComponent(partition)
            guard let urls = try? FileManager.default.contentsOfDirectory(
                at: partitionURL,
                includingPropertiesForKeys: [.isDirectoryKey],
                options: [.skipsHiddenFiles]
            ) else {
                return []
            }
            return urls.compactMap { url in
                let values = try? url.resourceValues(forKeys: [.isDirectoryKey])
                guard values?.isDirectory == true else { return nil }
                return WorkspaceProjectChoice(label: url.lastPathComponent, path: url.path)
            }
        }
    }

    private func firstBacktickValue(in text: String) -> String? {
        guard let start = text.firstIndex(of: "`") else { return nil }
        let remainder = text[text.index(after: start)...]
        guard let end = remainder.firstIndex(of: "`") else { return nil }
        return String(remainder[..<end])
    }

    private func stripMarkdown(_ text: String) -> String {
        text.replacingOccurrences(of: "`", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func htmlEscape(_ text: String) -> String {
        text
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }
}

private struct WorkspaceProjectChoice {
    let label: String
    let path: String
}

private enum BridgeError: LocalizedError {
    case invalidPayload(String)

    var errorDescription: String? {
        switch self {
        case .invalidPayload(let message):
            return message
        }
    }
}
