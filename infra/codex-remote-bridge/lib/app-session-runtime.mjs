import fs from "node:fs";
import path from "node:path";
import { createAccountSwitchProgressMonitor } from "./account-switch-status.mjs";
import { appendWakeupHistory } from "./accounts.mjs";
import {
  buildAppSessionNewArgs,
  buildAppSessionResumeArgs,
  findAppSession,
  listAppSessions,
  markAppSessionDesktopVisible,
} from "./app-sessions.mjs";
import { formatContextBundleForPrompt, readLastMessage, summarizeReply } from "./codex-output.mjs";
import { sanitizeLogText } from "./manager-core.mjs";
import { resolveWorkdir } from "./workdir.mjs";

export function shouldUseAppSession(job) {
  return (
    job.execution_mode === "app_session" ||
    job.app_session?.mode === "resume" ||
    job.app_session?.mode === "new" ||
    Boolean(job.app_session?.session_id)
  );
}

export async function runAppSessionJob({ paths, config, job, signal, cliPath, spawnCodex, onProgress }) {
  if (job.app_session?.mode === "new") {
    return runNewAppSessionJob({ paths, config, job, signal, cliPath, spawnCodex });
  }
  const startedAt = Date.now();
  const requestedWorkdir = resolveWorkdir({ config, job });
  const appSession = findAppSession({
    home: paths.home,
    selector: {
      ...job.app_session,
      project_path: job.app_session?.project_path || job.project?.path || requestedWorkdir,
      query: job.app_session?.query || job.prompt,
    },
  });
  if (!appSession) {
    throw new Error("未找到可接管的 Codex App 会话");
  }
  const workdir = resolveAppSessionWorkdir({ config, appSession, fallback: requestedWorkdir });
  const appCodexHome = path.join(paths.home, ".codex");
  if (!fs.existsSync(appCodexHome)) {
    throw new Error("Codex App CODEX_HOME 不存在，无法接管会话");
  }
  const releaseLock = acquireAppSessionLock(paths, appSession.id);
  const outputDir = path.join(paths.dataDir, "codex_app_session_outputs");
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `last_message_${job.job_id}.txt`);
  const prompt = buildAppSessionPrompt({ job, appSession, workdir });
  const args = buildAppSessionResumeArgs({ sessionId: appSession.id, outputPath, prompt, workdir });
  const account = { id: "codex_app_session", email: "Codex App session" };
  const monitorController = new AbortController();
  const switchMonitor = createAccountSwitchProgressMonitor({
    paths,
    jobId: job.job_id,
    send: onProgress,
    signal: monitorController.signal,
    intervalMs: Number(config.accountSwitchPollIntervalMs) || undefined,
    startedAfterMs: startedAt - 1000,
  });

  try {
    await spawnCodex(cliPath, args, { CODEX_HOME: appCodexHome }, signal);
    const reply = readLastMessage(outputPath);
    const durationMs = Date.now() - startedAt;
    appendAppSessionHistory({ paths, job, account, success: true, reply, durationMs, cliPath });
    return {
      type: "job.result",
      job_id: job.job_id,
      status: "succeeded",
      selected_account: { account_id: account.id, label: account.email },
      app_session: { session_id: appSession.id, thread_name: appSession.thread_name, cwd: workdir },
      duration_ms: durationMs,
      reply: summarizeReply(reply),
    };
  } catch (error) {
    appendAppSessionHistory({
      paths,
      job,
      account,
      success: false,
      reply: "",
      durationMs: Date.now() - startedAt,
      cliPath,
      error: sanitizeLogText(error?.message || String(error)),
    });
    throw error;
  } finally {
    monitorController.abort();
    await switchMonitor.done;
    releaseLock();
  }
}

async function runNewAppSessionJob({ paths, config, job, signal, cliPath, spawnCodex }) {
  const startedAt = Date.now();
  const projectless = job.app_session?.scope === "projectless";
  const workdir = projectless ? "" : resolveWorkdir({ config, job });
  const appCodexHome = path.join(paths.home, ".codex");
  if (!fs.existsSync(appCodexHome)) {
    throw new Error("Codex App CODEX_HOME 不存在，无法新建会话");
  }
  const beforeIds = new Set(listAppSessions({ home: paths.home, maxItems: 500 }).map((session) => session.id));
  const releaseLock = acquireAppSessionLock(paths, `new_${workdir || "projectless"}`);
  const outputDir = path.join(paths.dataDir, "codex_app_session_outputs");
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `last_message_${job.job_id}.txt`);
  const args = buildAppSessionNewArgs({ outputPath, prompt: job.prompt || "", workdir });
  const account = { id: "codex_app_session", email: "Codex App session" };

  try {
    await spawnCodex(cliPath, args, { CODEX_HOME: appCodexHome }, signal);
    const reply = readLastMessage(outputPath);
    const appSession = findNewAppSession({ home: paths.home, beforeIds, workdir, projectless });
    markAppSessionDesktopVisible({ home: paths.home, sessionId: appSession?.id });
    scheduleAppSessionDesktopVisibilityRepair({ home: paths.home, sessionId: appSession?.id });
    const durationMs = Date.now() - startedAt;
    appendAppSessionHistory({ paths, job, account, success: true, reply, durationMs, cliPath });
    return {
      type: "job.result",
      job_id: job.job_id,
      status: "succeeded",
      selected_account: { account_id: account.id, label: account.email },
      app_session: {
        session_id: appSession?.id || "",
        thread_name: appSession?.thread_name || job.prompt || "Untitled",
        cwd: appSession?.cwd || workdir,
      },
      duration_ms: durationMs,
      reply: summarizeReply(reply),
    };
  } catch (error) {
    appendAppSessionHistory({
      paths,
      job,
      account,
      success: false,
      reply: "",
      durationMs: Date.now() - startedAt,
      cliPath,
      error: sanitizeLogText(error?.message || String(error)),
    });
    throw error;
  } finally {
    releaseLock();
  }
}

function buildAppSessionPrompt({ job, appSession, workdir }) {
  const contextBundle = formatContextBundleForPrompt(job.context_bundle, {
    maxChars: 1800,
    maxContentChars: 220,
    maxDocuments: 5,
  });
  return `# Mobile App Session Resume
Continue the existing Codex App session from a WeChat bridge request.

Session: ${appSession.thread_name || appSession.id}
Workdir: ${workdir}

Rules:
1. Treat this as continuing the existing session, not starting a new project.
2. Keep the final reply concise for mobile: summary, evidence, next step.
3. Do not dump source code unless the user explicitly asks.

## Hermes Context Summary
${contextBundle}

## User Task
${job.prompt || ""}
`;
}

function resolveAppSessionWorkdir({ config, appSession, fallback }) {
  const cwd = String(appSession?.cwd || "").trim();
  if (!cwd) {
    return fallback;
  }
  const resolved = path.resolve(cwd);
  const allowed = config.allowedWorkdirs.some((root) => {
    const relative = path.relative(path.resolve(root), resolved);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
  return allowed ? resolved : fallback;
}

function findNewAppSession({ home, beforeIds, workdir, projectless = false }) {
  const resolvedWorkdir = path.resolve(workdir);
  return listAppSessions({ home, maxItems: 500 }).find((session) => {
    if (!session.id || beforeIds.has(session.id)) {
      return false;
    }
    if (projectless) {
      return true;
    }
    return path.resolve(String(session.cwd || "")) === resolvedWorkdir;
  });
}

function scheduleAppSessionDesktopVisibilityRepair({ home, sessionId }) {
  const id = String(sessionId || "").trim();
  if (!id) {
    return;
  }
  for (const delayMs of [1000, 5000, 15000, 60000]) {
    const timer = setTimeout(() => {
      markAppSessionDesktopVisible({ home, sessionId: id });
    }, delayMs);
    timer.unref?.();
  }
}

function appendAppSessionHistory(entry) {
  appendWakeupHistory({
    ...entry.paths,
  }, {
    jobId: entry.job.job_id,
    account: entry.account,
    success: entry.success,
    prompt: entry.job.prompt,
    reply: entry.reply,
    durationMs: entry.durationMs,
    cliPath: entry.cliPath,
    error: entry.error,
  });
}

function acquireAppSessionLock(paths, sessionId) {
  const locksDir = path.join(paths.dataDir, "codex_app_session_locks");
  fs.mkdirSync(locksDir, { recursive: true });
  const lockPath = path.join(locksDir, `${safeFileName(sessionId)}.lock`);
  let fd;
  try {
    fd = fs.openSync(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error("该 Codex App 会话正在被另一个任务接管，请稍后再试。");
    }
    throw error;
  }
  fs.writeFileSync(fd, JSON.stringify({ sessionId, pid: process.pid, lockedAt: new Date().toISOString() }));
  return () => {
    try {
      fs.closeSync(fd);
    } catch {}
    try {
      fs.unlinkSync(lockPath);
    } catch {}
  };
}

function safeFileName(value) {
  return String(value || "session").replace(/[^A-Za-z0-9._-]+/g, "_");
}
