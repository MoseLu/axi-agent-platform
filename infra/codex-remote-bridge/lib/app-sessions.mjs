import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

export function listAppSessions({ home = os.homedir(), maxItems = 50 } = {}) {
  const codexDir = path.join(home, ".codex");
  const byId = new Map();
  for (const session of readSessionIndex(codexDir)) {
    mergeSession(byId, session);
  }
  for (const session of readRolloutSessions(codexDir)) {
    mergeSession(byId, session);
  }
  for (const session of readStateThreads(codexDir)) {
    mergeSession(byId, session);
  }
  return [...byId.values()]
    .filter((session) => session.id)
    .sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")))
    .slice(0, maxItems);
}

export function listActiveAppTasks({ home = os.homedir(), windowSeconds = 180, maxItems = 10 } = {}) {
  const codexDir = path.join(home, ".codex");
  const logsDb = path.join(codexDir, "logs_2.sqlite");
  if (!fs.existsSync(logsDb)) {
    return [];
  }
  const seconds = Math.max(1, Math.floor(Number(windowSeconds) || 180));
  const limit = Math.max(1, Math.floor(Number(maxItems) || 10));
  const stateDb = path.join(codexDir, "state_5.sqlite");
  const hasStateDb = fs.existsSync(stateDb);
  const attachState = hasStateDb ? `attach database ${sqlLiteral(stateDb)} as state;` : "";
  const titleExpression = hasStateDb
    ? "coalesce(nullif(state.threads.title, ''), nullif(state.threads.first_user_message, ''), 'Untitled')"
    : "'Untitled'";
  const cwdExpression = hasStateDb ? "coalesce(state.threads.cwd, '')" : "''";
  const joinState = hasStateDb ? "left join state.threads on state.threads.id = recent.thread_id" : "";
  const visibleFilter = hasStateDb ? "where coalesce(state.threads.archived, 0) = 0" : "";

  try {
    const output = execFileSync(
      "sqlite3",
      [
        "-readonly",
        "-json",
        logsDb,
        `${attachState}
         with recent as (
           select thread_id, max(ts) as last_ts, count(*) as event_count
           from logs
           where ts > strftime('%s', 'now') - ${seconds}
             and thread_id is not null
             and thread_id != ''
             and feedback_log_body like '%session_task.turn%'
           group by thread_id
         )
         select recent.thread_id as id,
                ${titleExpression} as thread_name,
                ${cwdExpression} as cwd,
                recent.last_ts as last_seen_at,
                recent.event_count as event_count
         from recent
         ${joinState}
         ${visibleFilter}
         order by recent.last_ts desc
         limit ${limit}`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 },
    );
    const rows = JSON.parse(output || "[]");
    if (!Array.isArray(rows)) {
      return [];
    }
    return rows
      .filter((row) => row && row.id)
      .map((row) => ({
        id: String(row.id || ""),
        thread_name: String(row.thread_name || "Untitled"),
        cwd: String(row.cwd || ""),
        last_seen_at: formatThreadTimestamp(row.last_seen_at),
        event_count: Number(row.event_count || 0),
      }));
  } catch {
    return [];
  }
}

export function findAppSession({ home = os.homedir(), selector = {} } = {}) {
  const allSessions = listAppSessions({ home, maxItems: 200 });
  const explicitId = selector.session_id || selector.sessionId;
  if (explicitId) {
    return allSessions.find((session) => session.id === explicitId) || null;
  }
  const sessions = allSessions.filter(isVisibleSession);
  const scored = sessions
    .map((session) => ({ session, score: scoreSession(session, selector) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  return scored[0]?.session || null;
}

function isVisibleSession(session) {
  return session?.archived !== true && session?.archived !== 1 && session?.archived !== "1";
}

export function buildAppSessionResumeArgs({ sessionId, outputPath, prompt, workdir }) {
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--output-last-message",
    outputPath,
  ];
  if (workdir) {
    args.push("-C", workdir);
  }
  args.push(
    "resume",
    "--all",
    sessionId,
    prompt,
  );
  return args;
}

export function buildAppSessionNewArgs({ outputPath, prompt, workdir }) {
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--output-last-message",
    outputPath,
  ];
  if (workdir) {
    args.push("-C", workdir);
  }
  args.push(prompt);
  return args;
}

export function markAppSessionDesktopVisible({ home = os.homedir(), sessionId } = {}) {
  const id = String(sessionId || "").trim();
  if (!id) {
    return false;
  }
  const dbPath = path.join(home, ".codex", "state_5.sqlite");
  if (!fs.existsSync(dbPath)) {
    return false;
  }
  try {
    execFileSync(
      "sqlite3",
      [
        dbPath,
        `update threads
         set source = 'vscode'
         where id = ${sqlLiteral(id)}
           and source = 'exec'`,
      ],
      { stdio: ["ignore", "ignore", "ignore"], timeout: 5000 },
    );
    return true;
  } catch {
    return false;
  }
}

function readSessionIndex(codexDir) {
  const filePath = path.join(codexDir, "session_index.jsonl");
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseJsonLine)
    .filter(Boolean)
    .map((session) => ({
      id: String(session.id || ""),
      thread_name: String(session.thread_name || session.title || "Untitled"),
      updated_at: session.updated_at || "",
      cwd: session.cwd || "",
    }));
}

function readRolloutSessions(codexDir) {
  const root = path.join(codexDir, "sessions");
  const files = listRolloutFiles(root).slice(-300);
  return files
    .map(readRolloutSessionMeta)
    .filter(Boolean)
    .map((session) => ({
      id: String(session.id || ""),
      thread_name: session.thread_name || "Untitled",
      updated_at: session.updated_at || session.timestamp || "",
      cwd: session.cwd || "",
      rollout_path: session.rollout_path || "",
      last_assistant_summary: session.last_assistant_summary || "",
    }));
}

function readStateThreads(codexDir) {
  const dbPath = path.join(codexDir, "state_5.sqlite");
  if (!fs.existsSync(dbPath)) {
    return [];
  }
  try {
    const output = execFileSync(
      "sqlite3",
      [
        "-readonly",
        "-json",
        dbPath,
        `select id, title, first_user_message, cwd, rollout_path, archived, updated_at, updated_at_ms
         from threads
         order by coalesce(updated_at_ms, updated_at * 1000) desc
         limit 500`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 },
    );
    const rows = JSON.parse(output || "[]");
    if (!Array.isArray(rows)) {
      return [];
    }
    return rows
      .filter((row) => row && row.id)
      .map((row) => ({
        id: String(row.id || ""),
        thread_name: String(row.title || row.first_user_message || "Untitled"),
        updated_at: formatThreadTimestamp(row.updated_at_ms || row.updated_at),
        cwd: String(row.cwd || ""),
        rollout_path: String(row.rollout_path || ""),
        archived: Boolean(row.archived),
      }));
  } catch {
    return [];
  }
}

function listRolloutFiles(root) {
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listRolloutFiles(fullPath));
    } else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function readRolloutSessionMeta(filePath) {
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const lines = raw.split(/\r?\n/);
  const firstLine = lines[0] || "";
  const event = parseJsonLine(firstLine);
  if (event?.type !== "session_meta" || !event.payload?.id) {
    return null;
  }
  return {
    id: event.payload.id,
    cwd: event.payload.cwd,
    timestamp: event.payload.timestamp,
    rollout_path: filePath,
    last_assistant_summary: summarizeLastAssistantReply(lines),
  };
}

function mergeSession(byId, incoming) {
  if (!incoming?.id) {
    return;
  }
  const current = byId.get(incoming.id) || {};
  byId.set(incoming.id, {
    ...current,
    ...incoming,
    thread_name: bestThreadName(incoming.thread_name, current.thread_name),
    updated_at: latestTimestamp(incoming.updated_at, current.updated_at),
    cwd: incoming.cwd || current.cwd || "",
    rollout_path: incoming.rollout_path || current.rollout_path || "",
    last_assistant_summary: incoming.last_assistant_summary || current.last_assistant_summary || "",
  });
}

function summarizeLastAssistantReply(lines) {
  let lastReply = "";
  for (const line of lines) {
    const event = parseJsonLine(line);
    if (event?.type !== "response_item") {
      continue;
    }
    const payload = event.payload || {};
    if (payload.type !== "message" || payload.role !== "assistant" || !Array.isArray(payload.content)) {
      continue;
    }
    const text = payload.content
      .map((item) => item?.text || "")
      .filter(Boolean)
      .join("\n");
    if (text.trim()) {
      lastReply = text;
    }
  }
  return compactSummary(lastReply, 120);
}

function compactSummary(value, maxChars) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

function bestThreadName(candidate, fallback) {
  const value = String(candidate || "").trim();
  const previous = String(fallback || "").trim();
  if (value && value.toLowerCase() !== "untitled") {
    return value;
  }
  if (previous) {
    return previous;
  }
  return value || "Untitled";
}

function latestTimestamp(candidate, fallback) {
  const value = String(candidate || "");
  const previous = String(fallback || "");
  if (!value) {
    return previous;
  }
  if (!previous) {
    return value;
  }
  return value.localeCompare(previous) >= 0 ? value : previous;
}

function formatThreadTimestamp(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "";
  }
  const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  return new Date(millis).toISOString();
}

function scoreSession(session, selector) {
  let score = 0;
  const projectPath = selector.project_path || selector.projectPath || "";
  if (projectPath && session.cwd && isSameOrChild(session.cwd, projectPath)) {
    score += 50;
  }
  const query = `${selector.query || ""} ${selector.thread_name || selector.threadName || ""}`.trim();
  if (!query) {
    return score;
  }
  const haystack = `${session.thread_name || ""} ${session.cwd || ""}`.toLowerCase();
  for (const token of tokenize(query)) {
    if (haystack.includes(token)) {
      score += token.length >= 3 ? 8 : 2;
    } else if (token.length >= 4 && session.rollout_path && sessionContentIncludes(session.rollout_path, token)) {
      score += 12;
    }
  }
  return score;
}

function sessionContentIncludes(filePath, token) {
  try {
    return fs.readFileSync(filePath, "utf8").toLowerCase().includes(token);
  } catch {
    return false;
  }
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}:._-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function isSameOrChild(candidate, rootPath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function sqlLiteral(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}
