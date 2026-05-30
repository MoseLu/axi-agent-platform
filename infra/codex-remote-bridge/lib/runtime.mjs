import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  appendWakeupHistory,
  listAccounts,
  prepareManagedCodexHome,
  selectAccountCandidates,
} from "./accounts.mjs";
import { listActiveAppTasks, listAppSessions } from "./app-sessions.mjs";
import { runAppSessionJob, shouldUseAppSession } from "./app-session-runtime.mjs";
import {
  buildCodexSpawnEnv,
  resolveCodexCliPath,
  spawnCodex,
} from "./codex-spawn.mjs";
import { readJsonFile } from "./fs-json.mjs";
import {
  DEFAULT_PROJECTS_ROOT,
  normalizeConfig,
  packagePaths,
  readVersion,
  sanitizeLogText,
} from "./manager-core.mjs";
import {
  formatCodexCliFailure,
  formatContextBundleForPrompt,
  readLastMessage,
  shouldRetryCodexAccountFailure,
  summarizeReply,
} from "./codex-output.mjs";
import { listCodexProjects } from "./projects.mjs";
import { queryCodexHistory } from "./history.mjs";
import { listRuntimeCapabilities } from "./runtime-capabilities.mjs";
import { readStatus, writeStatus } from "./status.mjs";
import { resolveWorkdir } from "./workdir.mjs";

export {
  formatCodexCliFailure,
  formatContextBundleForPrompt,
  shouldRetryCodexAccountFailure,
} from "./codex-output.mjs";

export { buildCodexSpawnEnv, resolveCodexCliPath } from "./codex-spawn.mjs";

const HEARTBEAT_MS = 25_000;
const RECONNECT_MS = 10_000;
const DISABLED_MS = 30_000;

export async function runBridge({ paths = packagePaths(), version = readVersion() } = {}) {
  let stopRequested = false;
  const jobs = new Map();
  process.on("SIGTERM", () => {
    stopRequested = true;
    for (const controller of jobs.values()) controller.abort();
  });
  process.on("SIGINT", () => {
    stopRequested = true;
    for (const controller of jobs.values()) controller.abort();
  });

  while (!stopRequested) {
    const config = normalizeConfig(readJsonFile(paths.configPath, {}));
    writeStatus(paths, {
      running: true,
      enabled: config.enabled,
      connected: false,
      version,
      activeJobs: jobs.size,
      clientId: config.clientId,
      serverUrl: config.serverUrl,
      runtimeMode: "sidecar",
      lastUpdatedAt: new Date().toISOString(),
    });

    if (!config.enabled) {
      await delay(DISABLED_MS);
      continue;
    }
    if (!config.bridgeToken) {
      writeStatus(paths, { lastError: "bridgeToken is not configured" });
      await delay(RECONNECT_MS);
      continue;
    }

    try {
      await connectOnce({ paths, config, version, jobs, stopRequestedRef: () => stopRequested });
    } catch (error) {
      writeStatus(paths, {
        connected: false,
        lastError: sanitizeLogText(error?.message || String(error)),
      });
      await delay(RECONNECT_MS);
    }
  }
  writeStatus(paths, {
    running: false,
    connected: false,
    activeJobs: 0,
    lastUpdatedAt: new Date().toISOString(),
  });
}

async function connectOnce({ paths, config, version, jobs, stopRequestedRef }) {
  const ws = new WebSocket(config.serverUrl, {
    headers: { Authorization: `Bearer ${config.bridgeToken}` },
  });
  await onceOpen(ws);
  writeStatus(paths, {
    connected: true,
    lastError: undefined,
    lastSeenAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
  });
  sendJson(ws, {
    type: "register",
    client_id: config.clientId,
    version: "1",
    runtime: "sidecar",
    sidecar_version: version,
    capabilities: [
      "codex_exec",
      "account_auto_select",
      "cancel",
      "projects_list",
      "app_tasks_status",
      "app_sessions_list",
      "app_session_resume",
      "app_session_new",
    ],
  });

  const heartbeat = setInterval(() => sendJson(ws, { type: "heartbeat", ts: Date.now() }), HEARTBEAT_MS);
  try {
    await new Promise((resolve, reject) => {
      ws.addEventListener("message", (event) => {
        handleMessage({ paths, config, jobs, ws, raw: event.data }).catch((error) => {
          sendJson(ws, {
            type: "bridge.error",
            error_code: "message_handler_failed",
            error_message: sanitizeLogText(error?.message || String(error)),
          });
        });
      });
      ws.addEventListener("close", resolve);
      ws.addEventListener("error", reject);
      const guard = setInterval(() => {
        if (stopRequestedRef()) {
          ws.close();
        }
      }, 500);
      ws.addEventListener("close", () => clearInterval(guard), { once: true });
      ws.addEventListener("error", () => clearInterval(guard), { once: true });
    });
  } finally {
    clearInterval(heartbeat);
    writeStatus(paths, {
      connected: false,
      activeJobs: jobs.size,
      lastUpdatedAt: new Date().toISOString(),
    });
  }
}

async function handleMessage({ paths, config, jobs, ws, raw }) {
  const message = JSON.parse(String(raw));
  if (message.type === "ping") {
    sendJson(ws, { type: "pong", ts: Date.now() });
    return;
  }
  if (message.type === "status.get") {
    sendJson(ws, { type: "status.result", request_id: message.request_id, status: readStatus(paths) });
    return;
  }
  if (message.type === "accounts.list") {
    sendJson(ws, { type: "accounts.result", request_id: message.request_id, accounts: listAccounts({ paths }) });
    return;
  }
  if (message.type === "projects.list") {
    sendJson(ws, {
      type: "projects.result",
      request_id: message.request_id,
      projects: listCodexProjects({ home: paths.home }),
      sessions: publicAppSessions(paths),
    });
    return;
  }
  if (message.type === "history.query") {
    sendJson(ws, {
      type: "history.result",
      request_id: message.request_id,
      ...queryCodexHistory({
        home: paths.home,
        project: message.project || message.project_query || message.query,
        sinceDays: message.since_days ?? message.sinceDays,
        dateFrom: message.date_from ?? message.dateFrom,
        dateTo: message.date_to ?? message.dateTo,
        maxItems: message.max_items ?? message.maxItems,
      }),
    });
    return;
  }
  if (message.type === "runtime_capabilities.list") {
    sendJson(ws, {
      type: "runtime_capabilities.result",
      request_id: message.request_id,
      capabilities: listRuntimeCapabilities({ home: paths.home }),
    });
    return;
  }
  if (message.type === "app_tasks.status") {
    const windowSeconds = message.window_seconds ?? message.windowSeconds ?? 180;
    const tasks = listActiveAppTasks({ home: paths.home, windowSeconds });
    sendJson(ws, {
      type: "app_tasks.result",
      request_id: message.request_id,
      active_count: tasks.length,
      window_seconds: windowSeconds,
      tasks,
    });
    return;
  }
  if (message.type === "app_sessions.list") {
    sendJson(ws, {
      type: "app_sessions.result",
      request_id: message.request_id,
      sessions: publicAppSessions(paths),
    });
    return;
  }
  if (message.type === "job.cancel") {
    const controller = jobs.get(message.job_id);
    controller?.abort();
    sendJson(ws, { type: "job.cancelled", job_id: message.job_id, accepted: Boolean(controller) });
    return;
  }
  if (message.type === "job.start") {
    startJob({ paths, config, jobs, ws, job: message });
  }
}

function startJob({ paths, config, jobs, ws, job }) {
  const jobId = job.job_id || randomUUID();
  if (jobs.size >= config.maxConcurrentJobs) {
    sendJobFailure(ws, jobId, "local_concurrency_limit", "本地 Codex bridge 正在执行其他任务，请稍后再试。");
    return;
  }
  const controller = new AbortController();
  jobs.set(jobId, controller);
  writeStatus(paths, { activeJobs: jobs.size, lastUpdatedAt: new Date().toISOString() });
  runCodexJob({
    paths,
    config,
    job: { ...job, job_id: jobId },
    signal: controller.signal,
    onProgress: (payload) => sendJson(ws, payload),
  })
    .then((result) => sendJson(ws, result))
    .catch((error) => {
      sendJobFailure(ws, jobId, "local_codex_unavailable", sanitizeLogText(error?.message || String(error)));
    })
    .finally(() => {
      jobs.delete(jobId);
      writeStatus(paths, { activeJobs: jobs.size, lastUpdatedAt: new Date().toISOString() });
    });
}

export async function runCodexJob({ paths, config, job, signal, onProgress }) {
  if (shouldUseAppSession(job)) {
    return runAppSessionJob({
      paths,
      config,
      job,
      signal,
      cliPath: resolveCodexCliPath(),
      spawnCodex,
      onProgress,
    });
  }
  return runManagedAccountJob({ paths, config, job, signal });
}

async function runManagedAccountJob({ paths, config, job, signal }) {
  const startedAt = Date.now();
  const accounts = selectAccountCandidates({
    paths,
    selector: job.account_selector || { mode: "auto" },
    accountScope: config.accountScope,
  }).slice(0, 3);
  if (!accounts.length) {
    throw new Error(`No usable OAuth Plus Codex account matched selector: ${job.account_selector?.mode || "auto"}`);
  }
  const workdir = resolveWorkdir({ config, job });
  const prompt = buildExecutionPrompt({ config, job, workdir });
  const model = job.model || config.defaultModel;
  const reasoningEffort = job.reasoning_effort || config.defaultReasoningEffort;
  const cliPath = resolveCodexCliPath();
  let lastError = null;

  for (const account of accounts) {
    const codexHome = prepareManagedCodexHome({ paths, account });
    const outputPath = path.join(codexHome, `last_message_${job.job_id}.txt`);
    const args = buildCodexArgs({ config, model, reasoningEffort, outputPath, prompt, workdir });
    try {
      await spawnCodex(cliPath, args, { CODEX_HOME: codexHome }, signal);
      const reply = readLastMessage(outputPath);
      const durationMs = Date.now() - startedAt;
      appendWakeupHistory(paths, {
        jobId: job.job_id,
        account,
        success: true,
        prompt: job.prompt,
        model,
        reasoningEffort,
        reply,
        durationMs,
        cliPath,
      });
      return {
        type: "job.result",
        job_id: job.job_id,
        status: "succeeded",
        selected_account: { account_id: account.id, label: account.id },
        duration_ms: durationMs,
        reply: summarizeReply(reply),
      };
    } catch (error) {
      lastError = error;
      const message = sanitizeLogText(error?.message || String(error));
      appendWakeupHistory(paths, {
        jobId: job.job_id,
        account,
        success: false,
        prompt: job.prompt,
        model,
        reasoningEffort,
        reply: "",
        durationMs: Date.now() - startedAt,
        cliPath,
        error: message,
      });
      if (!shouldRetryCodexAccountFailure(message) || signal.aborted) {
        throw error;
      }
    }
  }

  throw lastError || new Error("No usable OAuth Plus Codex account completed the job");
}

function buildCodexArgs({ config, model, reasoningEffort, outputPath, prompt, workdir }) {
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "workspace-write",
    "--color",
    "never",
    "--output-last-message",
    outputPath,
    "-C",
    workdir,
  ];
  for (const root of config.allowedWorkdirs) {
    args.push("--add-dir", root);
  }
  if (model) args.push("-c", `model="${escapeToml(model)}"`);
  if (reasoningEffort) args.push("-c", `model_reasoning_effort="${escapeToml(reasoningEffort)}"`);
  args.push(prompt);
  return args;
}

function buildExecutionPrompt({ config, job, workdir }) {
  const contextBundle = formatContextBundleForPrompt(job.context_bundle);
  return `# Workflow Contract
Mac 本机是唯一开发执行环境，Hermes 只负责中转与知识库上下文。所有项目必须位于 ${DEFAULT_PROJECTS_ROOT}。

执行顺序：
1. 先阅读 Hermes Context Summary、项目 AGENTS.md 和 docs/codex/SESSION.md。
2. 缺少 AGENTS.md、PRD.md、README.md、TDD.md、TODO.md、MILESTONE.md、docs/codex/SESSION.md 或 docs/codex/EVIDENCE.md 时，先补齐项目文档，不直接进入功能开发。
3. 功能开发必须以 TODO.md 的功能节点为单位，给出验证证据；Web/UI 优先用 Playwright 截图，后端/CLI 用测试输出。
4. 最终回复只给摘要、项目路径、验证证据和下一步，不输出源码。

工作目录：${workdir}
允许写入目录：${config.allowedWorkdirs.join(", ")}

## Hermes Context Bundle
${contextBundle}

## User Task
${job.prompt || ""}
`;
}

function sendJobFailure(ws, jobId, errorCode, errorMessage) {
  sendJson(ws, {
    type: "job.result",
    job_id: jobId,
    status: "failed",
    error_code: errorCode,
    error_message: errorMessage,
  });
}

function sendJson(ws, value) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(value));
  }
}

function publicAppSessions(paths) {
  return listAppSessions({ home: paths.home }).map(({ rollout_path: _rolloutPath, ...session }) => session);
}

function onceOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeToml(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
