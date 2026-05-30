import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildCodexSpawnEnv,
  formatCodexCliFailure,
  formatContextBundleForPrompt,
  resolveCodexCliPath,
  runCodexJob,
  shouldRetryCodexAccountFailure,
} from "../lib/runtime.mjs";
import { DEFAULT_PROJECTS_ROOT, packagePaths } from "../lib/manager-core.mjs";

test("resolveCodexCliPath finds user-local Codex when launchd PATH is minimal", () => {
  const seen = new Set(["/Users/mose/.local/bin/codex"]);

  const cliPath = resolveCodexCliPath({
    env: {},
    home: "/Users/mose",
    exists: (candidate) => seen.has(candidate),
  });

  assert.equal(cliPath, "/Users/mose/.local/bin/codex");
});

test("resolveCodexCliPath keeps explicit CODEX_BRIDGE_CODEX_PATH first", () => {
  const cliPath = resolveCodexCliPath({
    env: { CODEX_BRIDGE_CODEX_PATH: "/custom/codex" },
    home: "/Users/mose",
    exists: () => true,
  });

  assert.equal(cliPath, "/custom/codex");
});

test("buildCodexSpawnEnv adds Node and user-local bins for launchd jobs", () => {
  const env = buildCodexSpawnEnv({
    baseEnv: { PATH: "/usr/bin:/bin" },
    extraEnv: { CODEX_HOME: "/tmp/codex-home" },
    home: "/Users/mose",
    nodePath: "/opt/custom-node/bin/node",
  });

  const parts = env.PATH.split(":");
  assert.equal(env.CODEX_HOME, "/tmp/codex-home");
  assert.equal(parts[0], "/opt/custom-node/bin");
  assert.ok(parts.includes("/Users/mose/.local/bin"));
  assert.ok(parts.includes("/usr/bin"));
});

test("formatCodexCliFailure keeps quota failures concise and strips context", () => {
  const raw = '... "has_credits":false ... "content":"very long context_bundle secret"';

  const message = formatCodexCliFailure(1, raw);

  assert.match(message, /Codex CLI exited with 1/);
  assert.match(message, /额度不足|credits/i);
  assert.doesNotMatch(message, /context_bundle|very long context|secret/);
});

test("formatContextBundleForPrompt emits bounded source summaries", () => {
  const bundle = {
    documents: [
      {
        path: "40-Resources/tools/feature-based-architecture.md",
        title: "Feature Architecture",
        content: "A".repeat(5000),
        sha256: "abc",
      },
    ],
  };

  const text = formatContextBundleForPrompt(bundle, { maxChars: 900, maxContentChars: 120 });

  assert.match(text, /feature-based-architecture/);
  assert.match(text, /Feature Architecture/);
  assert.ok(text.length <= 1000);
  assert.doesNotMatch(text, /A{500}/);
});

test("shouldRetryCodexAccountFailure only retries account capacity errors", () => {
  assert.equal(shouldRetryCodexAccountFailure("Codex 账号额度不足，请等待额度恢复"), true);
  assert.equal(shouldRetryCodexAccountFailure("Codex 账号触发限流，请稍后重试"), true);
  assert.equal(shouldRetryCodexAccountFailure("本地 Node.js 运行环境不可用"), false);
  assert.equal(shouldRetryCodexAccountFailure("项目路径不在 allowlist 中"), false);
});

test("runCodexJob can resume a Codex App session without selecting account pool", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-bridge-runtime-app-session-"));
  const paths = packagePaths(home, "0.1.0");
  const projectRoot = path.join(DEFAULT_PROJECTS_ROOT, `bridge-runtime-app-session-${path.basename(home)}`);
  const pollutedProjectRoot = path.join(DEFAULT_PROJECTS_ROOT, "019dd2d4-35db-7e41-90fd");
  const sessionId = "session_ielts";
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(
    path.join(home, ".codex", "session_index.jsonl"),
    JSON.stringify({
      id: sessionId,
      thread_name: "远程的艾宾浩斯统计按照当前00:00计算吗",
      updated_at: "2026-04-28T10:50:00Z",
      cwd: projectRoot,
    }),
  );
  const fakeCodex = path.join(home, "fake-codex.mjs");
  const argvPath = path.join(home, "argv.json");
  fs.writeFileSync(
    fakeCodex,
    `#!/usr/bin/env node
import fs from "node:fs";
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify({ args, env: { CODEX_HOME: process.env.CODEX_HOME } }));
const outIndex = args.indexOf("--output-last-message");
if (outIndex >= 0) fs.writeFileSync(args[outIndex + 1], "完成：App session resumed");
`,
    { mode: 0o755 },
  );

  const previous = process.env.CODEX_BRIDGE_CODEX_PATH;
  process.env.CODEX_BRIDGE_CODEX_PATH = fakeCodex;
  try {
    const result = await runCodexJob({
      paths,
      config: {
        allowedWorkdirs: [DEFAULT_PROJECTS_ROOT],
        accountScope: { mode: "all" },
        defaultModel: "",
        defaultReasoningEffort: "",
      },
      job: {
        job_id: "job_app_session",
        prompt: "继续检查远程统计",
        execution_mode: "app_session",
        app_session: { session_id: sessionId },
        project: { path: pollutedProjectRoot },
      },
      signal: new AbortController().signal,
    });

    const captured = JSON.parse(fs.readFileSync(argvPath, "utf8"));
    const prompt = captured.args.at(-1);
    assert.equal(result.status, "succeeded");
    assert.equal(result.selected_account.account_id, "codex_app_session");
    assert.equal(result.app_session.cwd, projectRoot);
    assert.equal(captured.args[0], "exec");
    assert.equal(captured.args[captured.args.indexOf("-C") + 1], projectRoot);
    assert.deepEqual(captured.args.slice(captured.args.indexOf("resume"), captured.args.indexOf("resume") + 3), [
      "resume",
      "--all",
      sessionId,
    ]);
    assert.equal(captured.env.CODEX_HOME, path.join(home, ".codex"));
    assert.match(prompt, new RegExp(escapeRegExp(projectRoot)));
    assert.doesNotMatch(prompt, new RegExp(escapeRegExp(pollutedProjectRoot)));
  } finally {
    if (previous === undefined) {
      delete process.env.CODEX_BRIDGE_CODEX_PATH;
    } else {
      process.env.CODEX_BRIDGE_CODEX_PATH = previous;
    }
  }
});

test("runCodexJob can start a new Codex App session in a selected project", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-bridge-runtime-new-app-session-"));
  const paths = packagePaths(home, "0.1.0");
  const projectRoot = path.join(DEFAULT_PROJECTS_ROOT, `new-app-session-${path.basename(home)}`);
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  const fakeCodex = path.join(home, "fake-codex-new.mjs");
  const argvPath = path.join(home, "argv-new.json");
  const sessionIndexPath = path.join(home, ".codex", "session_index.jsonl");
  fs.writeFileSync(
    fakeCodex,
    `#!/usr/bin/env node
import fs from "node:fs";
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify({ args, env: { CODEX_HOME: process.env.CODEX_HOME } }));
const outIndex = args.indexOf("--output-last-message");
if (outIndex >= 0) fs.writeFileSync(args[outIndex + 1], "当前项目包含若干子项目。");
fs.writeFileSync(${JSON.stringify(sessionIndexPath)}, JSON.stringify({
  id: "session_new_projects",
  thread_name: "当前项目有哪些子项目",
  updated_at: "2026-04-29T09:55:00Z",
  cwd: ${JSON.stringify(projectRoot)}
}) + "\\n");
`,
    { mode: 0o755 },
  );

  const previous = process.env.CODEX_BRIDGE_CODEX_PATH;
  process.env.CODEX_BRIDGE_CODEX_PATH = fakeCodex;
  try {
    const result = await runCodexJob({
      paths,
      config: {
        allowedWorkdirs: [DEFAULT_PROJECTS_ROOT],
        accountScope: { mode: "all" },
        defaultModel: "",
        defaultReasoningEffort: "",
      },
      job: {
        job_id: "job_new_app_session",
        prompt: "当前项目有哪些子项目",
        execution_mode: "app_session",
        app_session: { mode: "new", project_path: projectRoot },
        project: { path: projectRoot },
      },
      signal: new AbortController().signal,
    });

    const captured = JSON.parse(fs.readFileSync(argvPath, "utf8"));
    assert.equal(result.status, "succeeded");
    assert.equal(result.selected_account.account_id, "codex_app_session");
    assert.equal(result.app_session.session_id, "session_new_projects");
    assert.equal(result.app_session.cwd, projectRoot);
    assert.deepEqual(captured.args.slice(0, 1), ["exec"]);
    assert.notEqual(captured.args[1], "resume");
    assert.equal(captured.args[captured.args.indexOf("-C") + 1], projectRoot);
    assert.equal(captured.env.CODEX_HOME, path.join(home, ".codex"));
  } finally {
    if (previous === undefined) {
      delete process.env.CODEX_BRIDGE_CODEX_PATH;
    } else {
      process.env.CODEX_BRIDGE_CODEX_PATH = previous;
    }
  }
});

test("runCodexJob can start a projectless Codex App session", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-bridge-runtime-projectless-session-"));
  const paths = packagePaths(home, "0.1.0");
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  const fakeCodex = path.join(home, "fake-codex-projectless.mjs");
  const argvPath = path.join(home, "argv-projectless.json");
  const sessionIndexPath = path.join(home, ".codex", "session_index.jsonl");
  fs.writeFileSync(
    fakeCodex,
    `#!/usr/bin/env node
import fs from "node:fs";
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify({ args, env: { CODEX_HOME: process.env.CODEX_HOME } }));
const outIndex = args.indexOf("--output-last-message");
if (outIndex >= 0) fs.writeFileSync(args[outIndex + 1], "已建立无项目探索会话。");
fs.writeFileSync(${JSON.stringify(sessionIndexPath)}, JSON.stringify({
  id: "session_projectless",
  thread_name: "新的探索会话",
  updated_at: "2026-04-30T09:00:00Z",
  cwd: ""
}) + "\\n");
`,
    { mode: 0o755 },
  );

  const previous = process.env.CODEX_BRIDGE_CODEX_PATH;
  process.env.CODEX_BRIDGE_CODEX_PATH = fakeCodex;
  try {
    const result = await runCodexJob({
      paths,
      config: {
        allowedWorkdirs: [DEFAULT_PROJECTS_ROOT],
        accountScope: { mode: "all" },
        defaultModel: "",
        defaultReasoningEffort: "",
      },
      job: {
        job_id: "job_projectless_app_session",
        prompt: "帮我看看一个新模块的设计方向",
        execution_mode: "app_session",
        app_session: { mode: "new", scope: "projectless" },
      },
      signal: new AbortController().signal,
    });

    const captured = JSON.parse(fs.readFileSync(argvPath, "utf8"));
    assert.equal(result.status, "succeeded");
    assert.equal(result.app_session.session_id, "session_projectless");
    assert.equal(result.app_session.cwd, "");
    assert.deepEqual(captured.args.slice(0, 1), ["exec"]);
    assert.equal(captured.args.includes("-C"), false);
    assert.equal(captured.env.CODEX_HOME, path.join(home, ".codex"));
  } finally {
    if (previous === undefined) {
      delete process.env.CODEX_BRIDGE_CODEX_PATH;
    } else {
      process.env.CODEX_BRIDGE_CODEX_PATH = previous;
    }
  }
});

test("runCodexJob reports Cockpit account switching during App session takeover", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-bridge-runtime-switch-progress-"));
  const paths = packagePaths(home, "0.1.0");
  const projectRoot = path.join(DEFAULT_PROJECTS_ROOT, `bridge-runtime-switch-progress-${path.basename(home)}`);
  const sessionId = "session_switch_progress";
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(
    path.join(home, ".codex", "session_index.jsonl"),
    JSON.stringify({
      id: sessionId,
      thread_name: "切号状态可见性测试",
      updated_at: "2026-04-28T10:50:00Z",
      cwd: projectRoot,
    }),
  );
  const fakeCodex = path.join(home, "fake-codex-progress.mjs");
  fs.writeFileSync(
    fakeCodex,
    `#!/usr/bin/env node
import fs from "node:fs";
const args = process.argv.slice(2);
const statusPath = ${JSON.stringify(paths.accountSwitchStatusPath)};
fs.writeFileSync(statusPath, JSON.stringify({
  state: "switching",
  trigger: "auto_quota",
  fromAccountId: "codex_old",
  toAccountId: "codex_new",
  reason: "primary_window<=20%",
  startedAt: new Date().toISOString(),
}));
await new Promise((resolve) => setTimeout(resolve, 80));
const outIndex = args.indexOf("--output-last-message");
if (outIndex >= 0) fs.writeFileSync(args[outIndex + 1], "完成：App session resumed after switch notice");
`,
    { mode: 0o755 },
  );

  const previous = process.env.CODEX_BRIDGE_CODEX_PATH;
  const progress = [];
  process.env.CODEX_BRIDGE_CODEX_PATH = fakeCodex;
  try {
    const result = await runCodexJob({
      paths,
      config: {
        allowedWorkdirs: [DEFAULT_PROJECTS_ROOT],
        accountScope: { mode: "all" },
        defaultModel: "",
        defaultReasoningEffort: "",
        accountSwitchPollIntervalMs: 10,
      },
      job: {
        job_id: "job_switch_progress",
        prompt: "继续",
        execution_mode: "app_session",
        app_session: { session_id: sessionId },
        project: { path: projectRoot },
      },
      signal: new AbortController().signal,
      onProgress: (payload) => progress.push(payload),
    });

    assert.equal(result.status, "succeeded");
    assert.ok(progress.some((payload) => payload.state === "account_switching"));
    assert.equal(progress.find((payload) => payload.state === "account_switching").to_account_id, "codex_new");
  } finally {
    if (previous === undefined) {
      delete process.env.CODEX_BRIDGE_CODEX_PATH;
    } else {
      process.env.CODEX_BRIDGE_CODEX_PATH = previous;
    }
  }
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
