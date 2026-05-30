import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatCodexCliFailure } from "./codex-output.mjs";

export function spawnCodex(command, args, extraEnv, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: buildCodexSpawnEnv({ extraEnv }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    signal.addEventListener("abort", () => {
      child.kill("SIGTERM");
      reject(new Error("Codex job cancelled"));
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(formatCodexCliFailure(code, stderr)));
      }
    });
  });
}

export function buildCodexSpawnEnv({
  baseEnv = process.env,
  extraEnv = {},
  home = os.homedir(),
  nodePath = process.execPath,
} = {}) {
  const preferred = [
    path.dirname(nodePath),
    path.join(home, ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
  const existing = String(baseEnv.PATH || "").split(":").filter(Boolean);
  const seen = new Set();
  const pathParts = [];
  for (const item of [...preferred, ...existing]) {
    if (!item || seen.has(item)) {
      continue;
    }
    seen.add(item);
    pathParts.push(item);
  }
  return { ...baseEnv, ...extraEnv, PATH: pathParts.join(":") };
}

export function resolveCodexCliPath({
  env = process.env,
  home = os.homedir(),
  exists = fs.existsSync,
} = {}) {
  const explicit = String(env.CODEX_BRIDGE_CODEX_PATH || "").trim();
  if (explicit) {
    return explicit;
  }

  const candidates = [
    path.join(home, ".local", "bin", "codex"),
    "/Applications/Codex.app/Contents/Resources/codex",
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  ];
  for (const candidate of candidates) {
    if (exists(candidate)) {
      return candidate;
    }
  }
  return "codex";
}
