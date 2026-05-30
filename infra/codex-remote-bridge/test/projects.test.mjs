import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listCodexProjects } from "../lib/projects.mjs";

test("listCodexProjects reads Codex App roots and session index summaries", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-bridge-projects-"));
  const projectRoot = path.join(home, "projects", "demo-app");
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(
    path.join(home, ".codex", ".codex-global-state.json"),
    JSON.stringify({ project_roots: [projectRoot] }),
  );
  fs.writeFileSync(
    path.join(home, ".codex", "session_index.jsonl"),
    [
      JSON.stringify({
        id: "session_a",
        thread_name: "demo feature",
        updated_at: "2026-04-27T12:00:00Z",
        cwd: projectRoot,
      }),
      JSON.stringify({
        id: "session_b",
        thread_name: "other",
        updated_at: "2026-04-27T11:00:00Z",
        cwd: path.join(home, "elsewhere"),
      }),
    ].join("\n"),
  );

  const projects = listCodexProjects({ home, projectsRoot: path.join(home, "projects"), maxItems: 5 });

  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, "demo-app");
  assert.equal(projects[0].path, projectRoot);
  assert.equal(projects[0].sessions.length, 1);
  assert.equal(projects[0].sessions[0].id, "session_a");
});

test("listCodexProjects groups projects discovered from Codex App state threads", (t) => {
  if (!hasSqlite3()) {
    t.skip("sqlite3 CLI is unavailable");
    return;
  }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-bridge-project-state-"));
  const ieltsRoot = path.join(home, "projects", "ielts-vocab");
  const cockpitRoot = path.join(home, "projects", "cockpit-tools");
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.mkdirSync(ieltsRoot, { recursive: true });
  fs.mkdirSync(cockpitRoot, { recursive: true });
  writeThreadState(home, [
    {
      id: "session_ielts",
      title: "远程的艾宾浩斯统计按照当前00:00计算吗",
      cwd: ieltsRoot,
      updated_at_ms: Date.parse("2026-04-28T15:03:59.239Z"),
    },
    {
      id: "session_cockpit",
      title: "理清微信机器人支持",
      cwd: cockpitRoot,
      updated_at_ms: Date.parse("2026-04-27T18:33:38.851Z"),
    },
  ]);

  const projects = listCodexProjects({
    home,
    projectsRoot: path.join(home, "projects"),
    maxItems: 5,
  });

  assert.deepEqual(projects.map((project) => project.name), ["ielts-vocab", "cockpit-tools"]);
  assert.equal(projects[0].sessions[0].thread_name, "远程的艾宾浩斯统计按照当前00:00计算吗");
  assert.equal(projects[1].sessions[0].id, "session_cockpit");
});

test("listCodexProjects hides the workspace container root from visible projects", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-bridge-project-parent-"));
  const projectsRoot = path.join(home, "projects");
  const projectRoot = path.join(projectsRoot, "codex-remote-bridge");
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(
    path.join(home, ".codex", ".codex-global-state.json"),
    JSON.stringify({
      "project-order": [projectsRoot, projectRoot],
      "electron-saved-workspace-roots": [projectsRoot, projectRoot],
    }),
  );
  fs.writeFileSync(
    path.join(home, ".codex", "session_index.jsonl"),
    [
      JSON.stringify({
        id: "session_parent",
        thread_name: "定位 Hermes 桥",
        updated_at: "2026-04-29T09:42:00Z",
        cwd: projectsRoot,
      }),
      JSON.stringify({
        id: "session_bridge",
        thread_name: "Hermes bridge",
        updated_at: "2026-04-29T08:00:00Z",
        cwd: projectRoot,
      }),
    ].join("\n"),
  );

  const projects = listCodexProjects({ home, projectsRoot, maxItems: 5 });

  assert.deepEqual(projects.map((project) => project.name), ["codex-remote-bridge"]);
  assert.deepEqual(projects[0].sessions.map((session) => session.id), ["session_bridge"]);
});

test("listCodexProjects honors Codex App root hints for worktree sessions", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-bridge-project-hints-"));
  const projectsRoot = path.join(home, "projects");
  const cockpitRoot = path.join(projectsRoot, "cockpit-tools");
  const worktreeRoot = path.join(home, ".codex", "worktrees", "5d1e", "cockpit-tools");
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.mkdirSync(cockpitRoot, { recursive: true });
  fs.mkdirSync(worktreeRoot, { recursive: true });
  fs.writeFileSync(
    path.join(home, ".codex", ".codex-global-state.json"),
    JSON.stringify({
      "project-order": [projectsRoot, cockpitRoot],
      "thread-workspace-root-hints": { session_worktree: cockpitRoot },
    }),
  );
  fs.writeFileSync(
    path.join(home, ".codex", "session_index.jsonl"),
    `${JSON.stringify({
      id: "session_worktree",
      thread_name: "给我讲讲这个项目",
      updated_at: "2026-04-29T09:04:00Z",
      cwd: worktreeRoot,
    })}\n`,
  );

  const projects = listCodexProjects({ home, projectsRoot, maxItems: 5 });

  assert.deepEqual(projects.map((project) => project.name), ["cockpit-tools"]);
  assert.deepEqual(projects[0].sessions.map((session) => session.id), ["session_worktree"]);
});

test("listCodexProjects hides archived Codex App state threads", (t) => {
  if (!hasSqlite3()) {
    t.skip("sqlite3 CLI is unavailable");
    return;
  }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-bridge-project-archived-"));
  const projectRoot = path.join(home, "projects", "ielts-vocab");
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  writeThreadState(home, [
    {
      id: "active_session",
      title: "远程的艾宾浩斯统计按照当前00:00计算吗",
      cwd: projectRoot,
      updated_at_ms: Date.parse("2026-04-28T15:03:59.239Z"),
    },
    {
      id: "archived_session",
      title: "旧会话",
      cwd: projectRoot,
      archived: true,
      updated_at_ms: Date.parse("2026-04-27T15:03:59.239Z"),
    },
  ]);

  const projects = listCodexProjects({
    home,
    projectsRoot: path.join(home, "projects"),
    maxItems: 5,
  });

  assert.equal(projects.length, 1);
  assert.deepEqual(projects[0].sessions.map((session) => session.id), ["active_session"]);
});

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
      archived integer not null default 0,
      updated_at integer not null,
      updated_at_ms integer
    );`,
  ]);
  for (const row of rows) {
    execFileSync("sqlite3", [
      dbPath,
      `insert into threads (
        id, title, first_user_message, cwd, rollout_path, archived, updated_at, updated_at_ms
      ) values (
        ${sql(row.id)}, ${sql(row.title)}, ${sql(row.first_user_message || "")},
        ${sql(row.cwd)}, ${sql(row.rollout_path || "")}, ${row.archived ? 1 : 0},
        ${Math.floor((row.updated_at_ms || Date.now()) / 1000)}, ${row.updated_at_ms || "null"}
      );`,
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
