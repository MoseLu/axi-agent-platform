import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runProcess, summarizeProcessOutput } from "./process.mjs";
import { defaultAxiTodoHome, nowIso } from "./schema.mjs";

export function resolveCodexCliPath({ env = process.env, home = os.homedir(), existsSync } = {}) {
  const exists = existsSync || defaultExists;
  const explicit = String(env.AXI_TODO_CODEX_PATH || env.CODEX_CLI_PATH || "").trim();
  if (explicit) return explicit;
  const candidates = [
    "/Applications/Codex.app/Contents/Resources/codex",
    path.join(home, ".local", "bin", "codex"),
    path.join(home, "bin", "codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  ];
  return candidates.find((candidate) => exists(candidate)) || "codex";
}

export function buildCodexArgs(task, { outputPath, sandbox = "workspace-write", addDirs = [] } = {}) {
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    sandbox,
    "--color",
    "never",
    "--output-last-message",
    outputPath,
    "-C",
    task.cwd,
  ];
  for (const dir of addDirs) {
    if (dir) args.push("--add-dir", dir);
  }
  args.push(buildCodexPrompt(task));
  return args;
}

export async function executeTaskWithCodex(task, options = {}) {
  const runId = `${Date.now()}-${task.id}`;
  const home = options.home || defaultAxiTodoHome();
  const runDir = path.join(home, "runs", task.id);
  await fs.mkdir(runDir, { recursive: true });
  const outputPath = path.join(runDir, `${runId}.last-message.txt`);
  const codexCommand = options.codexCommand || resolveCodexCliPath();
  const codexArgs = [
    ...(options.codexArgsPrefix || []),
    ...buildCodexArgs(task, {
      outputPath,
      sandbox: options.sandbox || "workspace-write",
      addDirs: options.addDirs || [],
    }),
  ];

  const result = await runProcess(codexCommand, codexArgs, {
    cwd: task.cwd,
    timeoutMs: options.timeoutMs || 60 * 60 * 1000,
  });
  const lastMessage = await readOptionalFile(outputPath);
  const summary = lastMessage || summarizeProcessOutput(result);
  if (result.exitCode !== 0) {
    return {
      success: false,
      runId,
      outputPath,
      exitCode: result.exitCode,
      summary,
      error: summarizeProcessOutput(result) || `codex exited with ${result.exitCode}`,
    };
  }

  const verification = task.verifyCommand
    ? await runVerificationCommand(task, { timeoutMs: options.verifyTimeoutMs })
    : undefined;
  const verificationFailed = verification && verification.status !== "passed";
  return {
    success: !verificationFailed,
    runId,
    outputPath,
    exitCode: result.exitCode,
    summary,
    verification,
    error: verificationFailed ? "verification failed" : undefined,
  };
}

export async function runVerificationCommand(task, { timeoutMs = 10 * 60 * 1000 } = {}) {
  if (!task.verifyCommand) return undefined;
  const checkedAt = nowIso();
  const result = await runProcess(task.verifyCommand, [], {
    cwd: task.cwd,
    shell: true,
    timeoutMs,
  });
  const output = summarizeProcessOutput(result);
  return {
    status: result.exitCode === 0 ? "passed" : "failed",
    checkedAt,
    exitCode: result.exitCode,
    output,
  };
}

export function buildCodexPrompt(task) {
  const verification = task.verifyCommand
    ? `\nVerification command to satisfy before finishing:\n${task.verifyCommand}\n`
    : "\nNo explicit verification command was provided. Use the closest meaningful local check before finishing.\n";
  return `# Axi Todo Task

You are running from the local axi-todo daemon. Complete exactly this task and update only the relevant files under the requested working directory.

Task ID: ${task.id}
Title: ${task.title}
Working directory: ${task.cwd}

## User Request
${task.prompt}
${verification}
## Completion Contract
- Inspect the local project instructions before editing when they exist.
- Make the smallest change that satisfies the task.
- Run the verification command when provided.
- In the final answer, report changed files, verification evidence, and any remaining risk.
`;
}

async function readOptionalFile(filePath) {
  try {
    return (await fs.readFile(filePath, "utf8")).trim();
  } catch {
    return "";
  }
}

function defaultExists(candidate) {
  return existsSync(candidate);
}
