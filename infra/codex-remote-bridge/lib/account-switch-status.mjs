import fs from "node:fs";
import path from "node:path";

const DEFAULT_FRESH_MS = 120_000;
const DEFAULT_INTERVAL_MS = 2_500;

const PROGRESS_STATE_BY_SWITCH_STATE = new Map([
  ["switching", "account_switching"],
  ["succeeded", "account_switched"],
  ["failed", "account_switch_failed"],
]);

export function readAccountSwitchStatus({
  paths,
  freshMs = DEFAULT_FRESH_MS,
  nowMs = Date.now(),
} = {}) {
  return (
    readStructuredAccountSwitchStatus({ paths, freshMs, nowMs }) ??
    readCockpitLogAccountSwitchStatus({ paths, freshMs, nowMs })
  );
}

function readStructuredAccountSwitchStatus({
  paths,
  freshMs = DEFAULT_FRESH_MS,
  nowMs = Date.now(),
} = {}) {
  const filePath = paths?.accountSwitchStatusPath;
  if (!filePath) {
    return null;
  }
  let stat;
  let raw;
  try {
    stat = fs.statSync(filePath);
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const state = stringValue(parsed.state);
  if (!PROGRESS_STATE_BY_SWITCH_STATE.has(state)) {
    return null;
  }
  const startedAt = stringValue(parsed.startedAt ?? parsed.started_at);
  const finishedAt = stringValue(parsed.finishedAt ?? parsed.finished_at);
  const eventMs = parseTimeMs(finishedAt) || parseTimeMs(startedAt) || stat.mtimeMs;

  return {
    state,
    trigger: stringValue(parsed.trigger),
    fromAccountId: stringValue(parsed.fromAccountId ?? parsed.from_account_id),
    toAccountId: stringValue(parsed.toAccountId ?? parsed.to_account_id),
    reason: stringValue(parsed.reason),
    startedAt,
    finishedAt,
    eventMs,
    fresh: Number.isFinite(eventMs) && nowMs - eventMs <= freshMs,
  };
}

function readCockpitLogAccountSwitchStatus({
  paths,
  freshMs = DEFAULT_FRESH_MS,
  nowMs = Date.now(),
} = {}) {
  const logsDir = paths?.logsDir;
  if (!logsDir) {
    return null;
  }
  const events = [];
  for (const filePath of listRecentAppLogs(logsDir)) {
    for (const line of readTailLines(filePath)) {
      const event = parseCockpitSwitchLogLine(line, paths?.home);
      if (event) {
        events.push(event);
      }
    }
  }
  if (!events.length) {
    return null;
  }

  events.sort((a, b) => a.eventMs - b.eventMs);
  const latestStartByAccount = new Map();
  let latestStatus = null;
  for (const event of events) {
    if (event.kind === "start") {
      latestStartByAccount.set(event.toAccountId, event);
      latestStatus = {
        state: "switching",
        trigger: "cockpit_log",
        fromAccountId: "",
        toAccountId: event.toAccountId,
        reason: "Cockpit Tools app.log",
        startedAt: event.timestamp,
        finishedAt: "",
        eventMs: event.eventMs,
      };
      continue;
    }
    const start = latestStartByAccount.get(event.toAccountId);
    latestStatus = {
      state: "succeeded",
      trigger: "auto_quota",
      fromAccountId: "",
      toAccountId: event.toAccountId,
      reason: "Cockpit Tools app.log",
      startedAt: start?.timestamp || "",
      finishedAt: event.timestamp,
      eventMs: event.eventMs,
    };
  }

  if (!latestStatus) {
    return null;
  }
  return {
    ...latestStatus,
    fresh: Number.isFinite(latestStatus.eventMs) && nowMs - latestStatus.eventMs <= freshMs,
  };
}

function listRecentAppLogs(logsDir) {
  try {
    return fs
      .readdirSync(logsDir)
      .filter((name) => /^app\.log\./.test(name))
      .map((name) => path.join(logsDir, name))
      .map((filePath) => ({ filePath, stat: fs.statSync(filePath) }))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
      .slice(0, 3)
      .map((item) => item.filePath);
  } catch {
    return [];
  }
}

function readTailLines(filePath, maxBytes = 256 * 1024) {
  try {
    const stat = fs.statSync(filePath);
    const fd = fs.openSync(filePath, "r");
    try {
      const size = Math.min(stat.size, maxBytes);
      const buffer = Buffer.alloc(size);
      fs.readSync(fd, buffer, 0, size, stat.size - size);
      return buffer.toString("utf8").split(/\r?\n/);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
}

function parseCockpitSwitchLogLine(line, home) {
  const prefix = String(line || "").match(/^(\d{4}-\d{2}-\d{2}T\S+)\s+\S+\s+(.*)$/);
  if (!prefix) {
    return null;
  }
  const timestamp = prefix[1];
  const body = prefix[2];
  const eventMs = parseTimeMs(timestamp);
  if (!eventMs) {
    return null;
  }

  const startMatch = body.match(
    /\[Codex切号\]\s+开始切换账号:\s+account_id=([^,\s]+).*target_dir=([^,\s]+)/,
  );
  if (startMatch) {
    const targetDir = startMatch[2];
    const expectedDir = home ? path.join(home, ".codex") : "";
    if (expectedDir && targetDir !== expectedDir) {
      return null;
    }
    if (!expectedDir && !targetDir.endsWith("/.codex")) {
      return null;
    }
    return {
      kind: "start",
      timestamp,
      eventMs,
      toAccountId: startMatch[1],
    };
  }

  const completedMatch = body.match(
    /\[AutoSwitch\]\[Codex\]\s+自动切号完成:\s+target_id=([^,\s]+)/,
  );
  if (completedMatch) {
    return {
      kind: "complete",
      timestamp,
      eventMs,
      toAccountId: completedMatch[1],
    };
  }
  return null;
}

export function buildAccountSwitchProgressPayload(jobId, status) {
  const state = PROGRESS_STATE_BY_SWITCH_STATE.get(status?.state);
  if (!state) {
    return null;
  }
  const payload = {
    type: "job.progress",
    job_id: jobId,
    state,
    trigger: status.trigger || undefined,
    from_account_id: status.fromAccountId || undefined,
    to_account_id: status.toAccountId || undefined,
    reason: status.reason || undefined,
    recoverable: status.state !== "failed",
  };
  if (status.startedAt) payload.started_at = status.startedAt;
  if (status.finishedAt) payload.finished_at = status.finishedAt;
  return pruneUndefined(payload);
}

export function createAccountSwitchProgressMonitor({
  paths,
  jobId,
  send,
  signal,
  intervalMs = DEFAULT_INTERVAL_MS,
  freshMs = DEFAULT_FRESH_MS,
  startedAfterMs = 0,
} = {}) {
  let lastKey = "";
  let lastStatus = null;
  const done = (async () => {
    while (!signal?.aborted) {
      const status = readAccountSwitchStatus({ paths, freshMs });
      if (status?.fresh && status.eventMs >= startedAfterMs) {
        const key = `${status.state}:${status.startedAt}:${status.finishedAt}:${status.toAccountId}`;
        if (key !== lastKey) {
          const payload = buildAccountSwitchProgressPayload(jobId, status);
          if (payload) {
            lastKey = key;
            lastStatus = status;
            await Promise.resolve(send?.(payload));
          }
        }
      }
      await delay(intervalMs, signal);
    }
  })();
  return {
    done,
    getLastStatus: () => lastStatus,
  };
}

function parseTimeMs(value) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(normalizeDateTimeFraction(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDateTimeFraction(value) {
  return String(value).replace(/\.(\d{3})\d+([+-]\d{2}:\d{2}|Z)/, ".$1$2");
}

function stringValue(value) {
  return String(value ?? "").trim();
}

function pruneUndefined(value) {
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) {
      output[key] = item;
    }
  }
  return output;
}

function delay(ms, signal) {
  if (signal?.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}
