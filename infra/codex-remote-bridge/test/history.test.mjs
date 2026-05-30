import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { queryCodexHistory } from "../lib/history.mjs";

test("queryCodexHistory returns project-matched Codex sessions with evidence snippets", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-bridge-history-"));
  const projectRoot = path.join(home, "projects", "ielts-vocab");
  const otherRoot = path.join(home, "projects", "cockpit-tools");
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(otherRoot, { recursive: true });
  const rolloutPath = writeRollout(home, "session_a", projectRoot, [
    { role: "developer", text: "Filesystem sandboxing defines which files can be read or written." },
    "# AGENTS.md instructions for /Volumes/code/workspace/products/ielts-vocab\n<INSTRUCTIONS>\n# Project Notes\n</INSTRUCTIONS>",
    "用户要求：补上 artifact 发布 OSS。",
    "最终回复：增加 artifact OSS 发布脚本，并验证上传参数。",
  ]);
  writeRollout(home, "session_b", otherRoot, ["用户要求：给我讲讲这个项目。"]);
  fs.writeFileSync(
    path.join(home, ".codex", "session_index.jsonl"),
    [
      JSON.stringify({
        id: "session_a",
        thread_name: "补上 artifact 发布 OSS",
        updated_at: "2026-04-29T10:13:47.000Z",
        cwd: projectRoot,
      }),
      JSON.stringify({
        id: "session_b",
        thread_name: "给我讲讲这个项目",
        updated_at: "2026-04-29T09:04:50.000Z",
        cwd: otherRoot,
      }),
    ].join("\n"),
  );

  const result = queryCodexHistory({
    home,
    projectsRoot: path.join(home, "projects"),
    project: "ielts",
    sinceDays: 3,
    now: new Date("2026-04-30T00:00:00.000Z"),
    maxItems: 5,
  });

  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].id, "session_a");
  assert.equal(result.sessions[0].project_name, "ielts-vocab");
  assert.equal(result.sessions[0].rollout_path, rolloutPath);
  assert.match(result.sessions[0].evidence_snippets.join("\n"), /artifact OSS/);
  assert.doesNotMatch(result.sessions[0].evidence_snippets.join("\n"), /Filesystem sandboxing/);
  assert.doesNotMatch(result.sessions[0].evidence_snippets.join("\n"), /AGENTS\.md instructions/);
});

function writeRollout(home, sessionId, cwd, messages) {
  const dir = path.join(home, ".codex", "sessions", "2026", "04", "29");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `rollout-2026-04-29T10-13-47-${sessionId}.jsonl`);
  const lines = [
    JSON.stringify({
      type: "session_meta",
      payload: { id: sessionId, cwd, timestamp: "2026-04-29T10:13:47.000Z" },
    }),
    ...messages.map((entry, index) => {
      const role = typeof entry === "string" ? (index === 0 ? "user" : "assistant") : entry.role;
      const text = typeof entry === "string" ? entry : entry.text;
      return (
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role,
          content: [{ type: role === "user" ? "input_text" : "output_text", text }],
        },
      })
      );
    }),
  ];
  fs.writeFileSync(filePath, lines.join("\n"));
  return filePath;
}
