import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildAppSessionResumeArgs,
  findAppSession,
  listActiveAppTasks,
  listAppSessions,
  markAppSessionDesktopVisible,
} from "../lib/app-sessions.mjs";

test("listAppSessions merges Codex App index and rollout metadata", () => {
  const home = makeHome();
  const projectRoot = path.join(home, "projects", "ielts-vocab");
  const sessionId = "019dd3b1-3672-7fb2-aa10-897c21088d5e";
  writeIndex(home, [
    {
      id: sessionId,
      thread_name: "远程的艾宾浩斯统计按照当前00:00计算吗",
      updated_at: "2026-04-28T10:50:00Z",
    },
  ]);
  writeRollout(home, sessionId, projectRoot);

  const sessions = listAppSessions({ home });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, sessionId);
  assert.equal(sessions[0].thread_name, "远程的艾宾浩斯统计按照当前00:00计算吗");
  assert.equal(sessions[0].cwd, projectRoot);
});

test("listAppSessions reads canonical Codex App thread titles from state sqlite", (t) => {
  if (!hasSqlite3()) {
    t.skip("sqlite3 CLI is unavailable");
    return;
  }
  const home = makeHome();
  const projectRoot = path.join(home, "projects", "ielts-vocab");
  const sessionId = "019dd2d4-35db-7e41-90fd-73f2fda5c322";
  fs.mkdirSync(projectRoot, { recursive: true });
  writeIndex(home, [
    {
      id: sessionId,
      thread_name: "Untitled",
      updated_at: "2026-04-28T06:43:36.030Z",
    },
  ]);
  writeThreadState(home, [
    {
      id: sessionId,
      title: "远程的艾宾浩斯统计按照当前00:00计算吗",
      cwd: projectRoot,
      updated_at_ms: Date.parse("2026-04-28T15:03:59.239Z"),
    },
  ]);

  const sessions = listAppSessions({ home });

  assert.equal(sessions[0].id, sessionId);
  assert.equal(sessions[0].thread_name, "远程的艾宾浩斯统计按照当前00:00计算吗");
  assert.equal(sessions[0].cwd, projectRoot);
});

test("listAppSessions includes a summary of the last assistant reply", () => {
  const home = makeHome();
  const projectRoot = path.join(home, "projects", "ielts-vocab");
  const sessionId = "session_with_reply";
  writeIndex(home, [
    {
      id: sessionId,
      thread_name: "优化发包与OSS流程",
      updated_at: "2026-04-29T18:35:00Z",
      cwd: projectRoot,
    },
  ]);
  writeRollout(home, sessionId, projectRoot, [
    { role: "user", text: "继续检查 OSS 发布" },
    { role: "assistant", text: "我已经确认部署脚本会先读取 backend.env，再读取 microservices.env。" },
    { role: "user", text: "继续" },
    {
      role: "assistant",
      text: "已修复 OSS 上传参数，并验证生产构建会使用新的 CDN 地址。\n\n下一步可以跑线上 smoke test。",
    },
  ]);

  const sessions = listAppSessions({ home });

  assert.equal(sessions[0].last_assistant_summary, "已修复 OSS 上传参数，并验证生产构建会使用新的 CDN 地址。 下一步可以跑线上 smoke test。");
});

test("listActiveAppTasks reports recent running Codex App threads", (t) => {
  if (!hasSqlite3()) {
    t.skip("sqlite3 CLI is unavailable");
    return;
  }
  const home = makeHome();
  const now = Math.floor(Date.now() / 1000);
  writeThreadState(home, [
    {
      id: "task_one",
      title: "Finish the WeChat IM phone handoff end to end",
      cwd: "/Volumes/code/workspace/projects/axi-workbench/apps/ollama-menu-assistant",
      updated_at_ms: (now - 90) * 1000,
    },
    {
      id: "task_two",
      title: "已继续补全并安装 pet 图片",
      cwd: "/Volumes/code/workspace/projects/axi-workbench/apps/ollama-menu-assistant",
      updated_at_ms: (now - 45) * 1000,
    },
    {
      id: "task_three",
      title: "在管理员页面增第四个选项",
      cwd: "/Volumes/code/workspace/products/ielts-vocab",
      updated_at_ms: (now - 10) * 1000,
    },
    {
      id: "task_archived",
      title: "已归档任务",
      cwd: "/Volumes/code/workspace/old",
      archived: true,
      updated_at_ms: (now - 5) * 1000,
    },
  ]);
  writeTaskLogs(home, [
    { thread_id: "task_one", ts: now - 90 },
    { thread_id: "task_two", ts: now - 45 },
    { thread_id: "task_three", ts: now - 10 },
    { thread_id: "task_archived", ts: now - 5 },
    { thread_id: "task_old", ts: now - 900 },
  ]);

  const tasks = listActiveAppTasks({ home, windowSeconds: 180 });

  assert.equal(tasks.length, 3);
  assert.deepEqual(tasks.map((task) => task.id), ["task_three", "task_two", "task_one"]);
  assert.equal(tasks[0].thread_name, "在管理员页面增第四个选项");
  assert.equal(tasks[0].cwd, "/Volumes/code/workspace/products/ielts-vocab");
  assert.match(tasks[0].last_seen_at, /^\d{4}-\d{2}-\d{2}T/);
});

test("findAppSession prefers explicit id then matches project and query text", () => {
  const home = makeHome();
  const ieltsRoot = path.join(home, "projects", "ielts-vocab");
  const otherRoot = path.join(home, "projects", "other");
  writeIndex(home, [
    {
      id: "session_other",
      thread_name: "远程部署",
      updated_at: "2026-04-28T10:51:00Z",
      cwd: otherRoot,
    },
    {
      id: "session_ielts",
      thread_name: "远程的艾宾浩斯统计按照当前00:00计算吗",
      updated_at: "2026-04-28T10:50:00Z",
      cwd: ieltsRoot,
    },
  ]);

  assert.equal(findAppSession({ home, selector: { session_id: "session_other" } }).id, "session_other");
  assert.equal(
    findAppSession({
      home,
      selector: {
        project_path: ieltsRoot,
        query: "继续 ielts-vocab 艾宾浩斯 00:00",
      },
    }).id,
    "session_ielts",
  );
});

test("findAppSession can match a quoted topic from rollout content when title is untitled", () => {
  const home = makeHome();
  const ieltsRoot = path.join(home, "projects", "ielts-vocab");
  const otherRoot = path.join(home, "projects", "other");
  writeIndex(home, [
    {
      id: "session_other",
      thread_name: "Untitled",
      updated_at: "2026-04-28T10:52:00Z",
      cwd: otherRoot,
    },
    {
      id: "session_ielts",
      thread_name: "Untitled",
      updated_at: "2026-04-28T10:50:00Z",
      cwd: ieltsRoot,
    },
  ]);
  writeRollout(home, "session_other", otherRoot, "unrelated deployment chat");
  writeRollout(home, "session_ielts", ieltsRoot, "远程的艾宾浩斯统计按照当前00:00计算吗");

  const session = findAppSession({
    home,
    selector: {
      query: "继续 ielts-vocab 的“远程的艾宾浩斯统计按照当前00:00计算吗”会话",
    },
  });

  assert.equal(session.id, "session_ielts");
});

test("buildAppSessionResumeArgs uses codex exec resume with last-message output", () => {
  const args = buildAppSessionResumeArgs({
    sessionId: "session_ielts",
    outputPath: "/tmp/last-message.txt",
    workdir: "/Volumes/code/workspace/products/ielts-vocab",
    prompt: "继续检查远程统计",
  });

  assert.deepEqual(args, [
    "exec",
    "--skip-git-repo-check",
    "--output-last-message",
    "/tmp/last-message.txt",
    "-C",
    "/Volumes/code/workspace/products/ielts-vocab",
    "resume",
    "--all",
    "session_ielts",
    "继续检查远程统计",
  ]);
});

test("markAppSessionDesktopVisible makes a codex exec thread visible to the desktop app", (t) => {
  if (!hasSqlite3()) {
    t.skip("sqlite3 CLI is unavailable");
    return;
  }
  const home = makeHome();
  writeThreadState(home, [
    {
      id: "session_new",
      title: "当前项目有哪些子项目",
      cwd: path.join(home, "projects"),
      source: "exec",
      updated_at_ms: Date.parse("2026-04-29T10:36:12.872Z"),
    },
  ]);

  assert.equal(markAppSessionDesktopVisible({ home, sessionId: "session_new" }), true);

  const source = execFileSync(
    "sqlite3",
    [path.join(home, ".codex", "state_5.sqlite"), "select source from threads where id = 'session_new'"],
    { encoding: "utf8" },
  ).trim();
  assert.equal(source, "vscode");
});

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-bridge-app-sessions-"));
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  return home;
}

function writeIndex(home, entries) {
  fs.writeFileSync(
    path.join(home, ".codex", "session_index.jsonl"),
    entries.map((entry) => JSON.stringify(entry)).join("\n"),
  );
}

function writeRollout(home, sessionId, cwd, content = "") {
  const dir = path.join(home, ".codex", "sessions", "2026", "04", "28");
  fs.mkdirSync(dir, { recursive: true });
  const messages = Array.isArray(content)
    ? content
    : content
      ? [{ role: "user", text: content }]
      : [];
  fs.writeFileSync(
    path.join(dir, `rollout-2026-04-28T18-44-59-${sessionId}.jsonl`),
    [
      JSON.stringify({
        type: "session_meta",
        payload: {
          id: sessionId,
          cwd,
          timestamp: "2026-04-28T10:44:59Z",
        },
      }),
      ...messages.map((message) =>
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: message.role,
            content: [{ type: message.role === "user" ? "input_text" : "output_text", text: message.text }],
          },
        }),
      ),
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function writeThreadState(home, rows) {
  const dbPath = path.join(home, ".codex", "state_5.sqlite");
  execFileSync("sqlite3", [
    dbPath,
    `create table threads (
      id text primary key,
      title text not null,
      first_user_message text not null default '',
      cwd text not null,
      rollout_path text not null default '',
      source text not null default 'vscode',
      archived integer not null default 0,
      updated_at integer not null,
      updated_at_ms integer
    );`,
  ]);
  for (const row of rows) {
    execFileSync("sqlite3", [
      dbPath,
      `insert into threads (
        id, title, first_user_message, cwd, rollout_path, source, archived, updated_at, updated_at_ms
      ) values (
        ${sql(row.id)}, ${sql(row.title)}, ${sql(row.first_user_message || "")},
        ${sql(row.cwd)}, ${sql(row.rollout_path || "")}, ${sql(row.source || "vscode")}, ${row.archived ? 1 : 0},
        ${Math.floor((row.updated_at_ms || Date.now()) / 1000)}, ${row.updated_at_ms || "null"}
      );`,
    ]);
  }
}

function writeTaskLogs(home, rows) {
  const dbPath = path.join(home, ".codex", "logs_2.sqlite");
  execFileSync("sqlite3", [
    dbPath,
    `create table logs (
      ts integer not null,
      thread_id text,
      feedback_log_body text
    );`,
  ]);
  for (const row of rows) {
    execFileSync("sqlite3", [
      dbPath,
      `insert into logs (ts, thread_id, feedback_log_body)
       values (${row.ts}, ${sql(row.thread_id)}, ${sql(row.feedback_log_body || "session_task.turn")});`,
    ]);
  }
}

function hasSqlite3() {
  try {
    execFileSync("sqlite3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function sql(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}
