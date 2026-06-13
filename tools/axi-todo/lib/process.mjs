import { spawn } from "node:child_process";

const DEFAULT_MAX_BUFFER = 64 * 1024;

/**
 * Append `next` to `current` while keeping the total under `max` bytes.
 * If truncation occurs, the leading portion is dropped (so the most recent
 * output is preserved) and the dropped byte count is reported.
 *
 * @param {string} current
 * @param {string} next
 * @param {number} max
 * @returns {{ text: string, truncated: boolean, droppedBytes: number }}
 */
function appendBounded(current, next, max) {
  const incoming = `${current}${next}`;
  if (incoming.length <= max) {
    return { text: incoming, truncated: false, droppedBytes: 0 };
  }
  const droppedBytes = incoming.length - max;
  return { text: incoming.slice(droppedBytes), truncated: true, droppedBytes };
}

/**
 * Track stdout/stderr truncation while consuming child-process output.
 * Each stream is bounded to `max` bytes independently and reports whether
 * any data was discarded, plus the total bytes dropped.
 */
function createTruncationTracker(max = DEFAULT_MAX_BUFFER) {
  let stdout = "";
  let stderr = "";
  const droppedBytes = { stdout: 0, stderr: 0 };
  const truncated = { stdout: false, stderr: false };
  return {
    pushStdout(chunk) {
      const result = appendBounded(stdout, chunk.toString(), max);
      stdout = result.text;
      if (result.truncated) {
        truncated.stdout = true;
        droppedBytes.stdout += result.droppedBytes;
      }
    },
    pushStderr(chunk) {
      const result = appendBounded(stderr, chunk.toString(), max);
      stderr = result.text;
      if (result.truncated) {
        truncated.stderr = true;
        droppedBytes.stderr += result.droppedBytes;
      }
    },
    snapshot() {
      return { stdout, stderr, truncated, droppedBytes: { ...droppedBytes } };
    },
  };
}

export function runProcess(command, args = [], { cwd, env, timeoutMs = 30 * 60 * 1000, shell = false, maxBuffer = DEFAULT_MAX_BUFFER } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const tracker = createTruncationTracker(maxBuffer);
    let settled = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          if (settled) return;
          child.kill("SIGTERM");
        }, timeoutMs)
      : null;

    child.stdout.on("data", (chunk) => {
      tracker.pushStdout(chunk);
    });
    child.stderr.on("data", (chunk) => {
      tracker.pushStderr(chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const snap = tracker.snapshot();
      resolve({ exitCode: 127, stdout: snap.stdout, stderr: snap.stderr, truncated: snap.truncated, droppedBytes: snap.droppedBytes, error: error.message });
    });
    child.on("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const exitCode = code === null ? 124 : code;
      const snap = tracker.snapshot();
      resolve({ exitCode, signal, stdout: snap.stdout, stderr: snap.stderr, truncated: snap.truncated, droppedBytes: snap.droppedBytes });
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
