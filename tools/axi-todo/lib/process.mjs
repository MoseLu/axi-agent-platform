import { spawn } from "node:child_process";

const DEFAULT_MAX_BUFFER = 64 * 1024;

export function runProcess(command, args = [], { cwd, env, timeoutMs = 30 * 60 * 1000, shell = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          if (settled) return;
          child.kill("SIGTERM");
        }, timeoutMs)
      : null;

    child.stdout.on("data", (chunk) => {
      stdout = appendBounded(stdout, chunk.toString(), DEFAULT_MAX_BUFFER);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk.toString(), DEFAULT_MAX_BUFFER);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ exitCode: 127, stdout, stderr, error: error.message });
    });
    child.on("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const exitCode = code === null ? 124 : code;
      resolve({ exitCode, signal, stdout, stderr });
    });
  });
}

export function summarizeProcessOutput(result = {}) {
  const parts = [];
  if (result.stdout) parts.push(result.stdout.trim());
  if (result.stderr) parts.push(result.stderr.trim());
  if (result.error) parts.push(result.error);
  return parts.join("\n").trim();
}

function appendBounded(current, next, max) {
  const output = `${current}${next}`;
  return output.length > max ? output.slice(output.length - max) : output;
}
