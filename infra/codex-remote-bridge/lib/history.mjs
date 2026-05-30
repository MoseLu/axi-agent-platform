import fs from "node:fs";
import path from "node:path";
import { listAppSessions } from "./app-sessions.mjs";

const DEFAULT_PROJECTS_ROOT = "/Volumes/code/workspace";

export function queryCodexHistory({
  home,
  projectsRoot = DEFAULT_PROJECTS_ROOT,
  project = "",
  sinceDays,
  dateFrom,
  dateTo,
  now = new Date(),
  maxItems = 20,
  maxSnippets = 3,
} = {}) {
  const start = resolveStartDate({ sinceDays, dateFrom, now });
  const end = dateTo ? new Date(dateTo) : null;
  const projectNeedle = normalizeMatchText(project);
  const sessions = listAppSessions({ home, maxItems: 500 })
    .filter((session) => isVisibleSession(session))
    .filter((session) => withinWindow(session.updated_at, start, end))
    .filter((session) => matchesProject(session, projectNeedle, projectsRoot))
    .slice(0, maxItems)
    .map((session) => historyRow(session, projectsRoot, maxSnippets));

  return {
    query: {
      project: project || "",
      since_days: sinceDays ?? null,
      date_from: start ? start.toISOString() : "",
      date_to: end ? end.toISOString() : "",
    },
    sessions,
  };
}

function historyRow(session, projectsRoot, maxSnippets) {
  const projectRoot = projectRootFromPath(session.cwd, projectsRoot);
  return {
    id: session.id,
    thread_name: session.thread_name || "Untitled",
    title: session.thread_name || "Untitled",
    updated_at: session.updated_at || "",
    cwd: session.cwd || "",
    project_name: projectRoot ? path.basename(projectRoot) : "",
    project_path: projectRoot,
    rollout_path: session.rollout_path || "",
    evidence_snippets: readEvidenceSnippets(session.rollout_path, maxSnippets),
  };
}

function readEvidenceSnippets(filePath, maxSnippets) {
  const value = String(filePath || "").trim();
  if (!value) {
    return [];
  }
  let raw = "";
  try {
    raw = fs.readFileSync(value, "utf8");
  } catch {
    return [];
  }
  const snippets = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const event = parseJsonLine(line);
    const text = extractEventText(event);
    if (!text) {
      continue;
    }
    const snippet = compactWhitespace(text);
    if (isBoilerplateSnippet(snippet)) {
      continue;
    }
    snippets.push(snippet.slice(0, 220));
    if (snippets.length >= maxSnippets) {
      break;
    }
  }
  return snippets;
}

function extractEventText(event) {
  const payload = event?.payload || {};
  if (event?.type === "event_msg" && payload.message) {
    return String(payload.message || "");
  }
  if (!["user", "assistant"].includes(String(payload.role || ""))) {
    return "";
  }
  if (payload.type !== "message" || !Array.isArray(payload.content)) {
    return "";
  }
  return payload.content
    .map((item) => item?.text || "")
    .filter(Boolean)
    .join("\n");
}

function matchesProject(session, projectNeedle, projectsRoot) {
  if (!projectNeedle) {
    return true;
  }
  const projectRoot = projectRootFromPath(session.cwd, projectsRoot);
  const haystack = normalizeMatchText(
    [
      session.thread_name,
      session.cwd,
      projectRoot,
      projectRoot ? path.basename(projectRoot) : "",
    ].join(" "),
  );
  return haystack.includes(projectNeedle);
}

function projectRootFromPath(candidate, projectsRoot) {
  const value = String(candidate || "").trim();
  if (!value) {
    return "";
  }
  const resolvedRoot = path.resolve(projectsRoot);
  const resolved = path.resolve(value);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative === "") {
    return resolvedRoot;
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return "";
  }
  const [projectName] = relative.split(path.sep);
  return projectName ? path.join(resolvedRoot, projectName) : "";
}

function withinWindow(value, start, end) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  if (start && date < start) {
    return false;
  }
  if (end && date > end) {
    return false;
  }
  return true;
}

function resolveStartDate({ sinceDays, dateFrom, now }) {
  if (dateFrom) {
    return new Date(dateFrom);
  }
  const days = Number(sinceDays || 0);
  if (!Number.isFinite(days) || days <= 0) {
    return null;
  }
  return new Date(new Date(now).getTime() - days * 24 * 60 * 60 * 1000);
}

function isVisibleSession(session) {
  return session?.archived !== true && session?.archived !== 1 && session?.archived !== "1";
}

function normalizeMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^0-9a-z\u4e00-\u9fff]+/g, "");
}

function compactWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isBoilerplateSnippet(value) {
  const text = String(value || "").trim();
  return (
    text.startsWith("# AGENTS.md instructions") ||
    text.startsWith("<environment_context>") ||
    text.startsWith("<permissions instructions>") ||
    text.startsWith("Filesystem sandboxing defines") ||
    text.startsWith("Knowledge cutoff:") ||
    text.startsWith("You are an AI assistant") ||
    text.includes("<INSTRUCTIONS>") ||
    text.includes("</INSTRUCTIONS>") ||
    text.includes("<environment_context>") ||
    text.includes("<permissions instructions>")
  );
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
