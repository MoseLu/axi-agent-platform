import os from "node:os";
import path from "node:path";
import { readJsonFile, safeStat } from "./fs-json.mjs";
import { listAppSessions } from "./app-sessions.mjs";

const DEFAULT_PROJECTS_ROOT = "/Volumes/code/workspace";

export function listCodexProjects({
  home = os.homedir(),
  maxItems = 20,
  maxSessions = 12,
  projectsRoot = DEFAULT_PROJECTS_ROOT,
} = {}) {
  const codexDir = path.join(home, ".codex");
  const state = readJsonFile(path.join(codexDir, ".codex-global-state.json"), {});
  const sessions = listAppSessions({ home, maxItems: 500 }).filter(isVisibleSession);
  const roots = collectWorkspaceRoots(state, projectsRoot);
  const rootHints = state["thread-workspace-root-hints"] || {};

  for (const session of sessions) {
    const root = projectRootFromPath(session.cwd, projectsRoot);
    if (root) {
      roots.push(root);
    }
  }

  return uniquePaths(roots)
    .map((rootPath) => ({
      name: path.basename(rootPath),
      path: rootPath,
      exists: Boolean(safeStat(rootPath)?.isDirectory()),
      sessions: sessions
        .filter((session) => sessionBelongsToRoot(session, rootHints, rootPath, projectsRoot))
        .slice(0, maxSessions),
    }))
    .filter((project) => project.exists || project.sessions.length)
    .slice(0, maxItems);
}

function collectWorkspaceRoots(state, projectsRoot) {
  const candidates = [
    state.project_roots,
    state["project-order"],
    state["electron-saved-workspace-roots"],
    state["active-workspace-roots"],
  ];
  const seen = new Set();
  const roots = [];
  for (const group of candidates) {
    if (!Array.isArray(group)) {
      continue;
    }
    for (const item of group) {
      if (typeof item !== "string" || !item || seen.has(item)) {
        continue;
      }
      const root = projectRootFromPath(item, projectsRoot);
      if (!root || seen.has(root)) {
        continue;
      }
      seen.add(root);
      roots.push(root);
    }
  }
  return roots;
}

function sessionBelongsToRoot(session, rootHints, rootPath, projectsRoot) {
  const hintedRoot = rootHints?.[session.id];
  if (hintedRoot) {
    return isSamePath(hintedRoot, rootPath);
  }
  const sessionRoot = projectRootFromPath(session.cwd, projectsRoot);
  return Boolean(sessionRoot && isSamePath(sessionRoot, rootPath));
}

function isSamePath(left, right) {
  return path.resolve(left) === path.resolve(right);
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
    return "";
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return "";
  }
  const [projectName] = relative.split(path.sep);
  if (!projectName) {
    return "";
  }
  return path.join(resolvedRoot, projectName);
}

function isVisibleSession(session) {
  return session?.archived !== true && session?.archived !== 1 && session?.archived !== "1";
}

function uniquePaths(paths) {
  const seen = new Set();
  const output = [];
  for (const item of paths) {
    const value = String(item || "").trim();
    if (!value) {
      continue;
    }
    const resolved = path.resolve(value);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    output.push(resolved);
  }
  return output;
}
