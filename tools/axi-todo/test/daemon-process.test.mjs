import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("daemon process stays alive between interval ticks", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-daemon-process-"));
  const child = spawn(process.execPath, ["bin/axi-todo-daemon.mjs", "--interval-ms", "10000"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: { ...process.env, AXI_TODO_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForStdout(child);
    await delay(200);
    assert.equal(child.exitCode, null);
  } finally {
    child.kill("SIGTERM");
  }
});

function waitForStdout(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("daemon did not emit first tick")), 3000);
    child.stdout.once("data", () => {
      clearTimeout(timer);
      resolve();
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`daemon exited early with ${code}`));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
