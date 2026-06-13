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
  // A3: parse machine-readable Evidence section out of the model's last message.
  // If the task declares an evidenceContract the section is required and a
  // missing/empty section will surface as `evidenceMissing: true` to the
  // store layer so it can refuse to mark the task completed.
  const evidence = parseEvidenceSection(lastMessage);
  const claimFiles = parseClaimedFiles(lastMessage);
  const warnings = buildTruncationWarnings(result.truncated, result.droppedBytes, "codex");
  if (evidence.missing && lastMessage) {
    warnings.push("evidence-section-missing-in-last-message");
  }
  if (result.exitCode !== 0) {
    return {
      success: false,
      runId,
      outputPath,
      exitCode: result.exitCode,
      summary,
      evidence,
      claimFiles,
      evidenceMissing: evidence.missing,
      warnings,
      error: summarizeProcessOutput(result) || `codex exited with ${result.exitCode}`,
    };
  }

  const verification = task.verifyCommand
    ? await runVerificationCommand(task, { timeoutMs: options.verifyTimeoutMs })
    : undefined;
  // A4b: surface truncation from the verify-command subprocess inside the
  // verification block so the store layer and the evidence log can record it.
  if (verification) {
    verification.warnings = (verification.warnings || []).concat(
      buildTruncationWarnings(verification.truncated, verification.droppedBytes, "verify"),
    );
    delete verification.truncated;
    delete verification.droppedBytes;
  }
  const verificationFailed = verification && verification.status !== "passed";
  return {
    success: !verificationFailed,
    runId,
    outputPath,
    exitCode: result.exitCode,
    summary,
    evidence,
    claimFiles,
    evidenceMissing: evidence.missing,
    warnings,
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
    truncated: result.truncated,
    droppedBytes: result.droppedBytes,
  };
}

export function buildCodexPrompt(task) {
  const verification = task.verifyCommand
    ? `\nVerification command to satisfy before finishing:\n${task.verifyCommand}\n`
    : "\nNo explicit verification command was provided. Use the closest meaningful local check before finishing.\n";
  // A1: surface the rejected-approaches list (if any) and the evidence contract
  // (if any) so the model sees them on every run instead of having to discover
  // them via search. Empty/blank fields are dropped to keep prompts small.
  const rejected = formatRejectedApproaches(task.rejectedApproaches);
  const evidence = formatEvidenceContract(task.evidenceContract);
  return `# Axi Todo Task

You are running from the local axi-todo daemon. Complete exactly this task and update only the relevant files under the requested working directory.

Task ID: ${task.id}
Title: ${task.title}
Working directory: ${task.cwd}

## User Request
${task.prompt}
${verification}${rejected}${evidence}
## Completion Contract
- Inspect the local project instructions before editing when they exist.
- Make the smallest change that satisfies the task.
- Run the verification command when provided.
- In the final answer, report changed files, verification evidence, and any remaining risk.
- If an Evidence Contract is specified above, your final answer MUST include a machine-parseable \`## Evidence\` section in the exact format below; the daemon will refuse to mark this task complete otherwise.
  \`\`\`
  ## Evidence
  - claim: <one-sentence conclusion>
  - files:
    - <path relative to the working directory>
  - checks:
    - <check name>: <result>
  - warnings:
    - <anything the next agent should know>
  \`\`\`
`;
}

function formatRejectedApproaches(value) {
  if (!Array.isArray(value) || value.length === 0) return "";
  const items = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  if (items.length === 0) return "";
  const body = items.map((entry) => `- ${entry}`).join("\n");
  return `\n## Rejected Approaches
The following approaches have already been tried or explicitly rejected. Do not repeat them; if you would otherwise reach for one, justify why the situation has changed.
${body}
`;
}

function formatEvidenceContract(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return `\n## Evidence Contract
Your final answer MUST include a \`## Evidence\` section satisfying the following. Missing or malformed sections will block the task from being marked complete.
${trimmed}
`;
}

const EVIDENCE_HEADING = /^#{1,6}\s+Evidence\s*$/im;

/**
 * Pull the first `## Evidence` (or similar) section out of the model's last
 * message. Returns the raw block plus a structured shape:
 *   { missing, raw, claim, files: string[], checks: string[], warnings: string[] }
 *
 * "Missing" means we could not find any `## Evidence` heading OR we found one
 * but the section is empty / has neither a `claim` line nor a `files:` block.
 * That signal is what the store layer uses to gate task completion when the
 * task declares an `evidenceContract`.
 */
export function parseEvidenceSection(text) {
  const empty = { missing: true, raw: "", claim: "", files: [], checks: [], warnings: [] };
  if (typeof text !== "string" || text.trim() === "") return empty;
  const match = text.match(EVIDENCE_HEADING);
  if (!match) return empty;
  const startIndex = match.index + match[0].length;
  const remainder = text.slice(startIndex);
  // Evidence section ends at the next markdown heading of equal or higher
  // level. Anything after that is just the model's free-form notes.
  const endMatch = remainder.match(/^#{1,6}\s+\S/m);
  const raw = endMatch ? remainder.slice(0, endMatch.index) : remainder;
  const trimmed = raw.trim();
  if (!trimmed) return empty;
  const claimMatch = trimmed.match(/^-\s*claim:\s*(.+)$/m);
  const claim = claimMatch ? claimMatch[1].trim() : "";
  const files = collectBulletList(trimmed, /^-\s*files:\s*$/m, "files");
  const checks = collectBulletList(trimmed, /^-\s*checks:\s*$/m, "checks");
  const warnings = collectBulletList(trimmed, /^-\s*warnings:\s*$/m, "warnings");
  const missing = !claim && files.length === 0;
  return { missing, raw: trimmed, claim, files, checks, warnings };
}

/**
 * Walk forward from the `files:` / `checks:` / `warnings:` marker and collect
 * indented bullets until we hit a sibling key (`- foo:`) or run out of input.
 * The model writes these as:
 *   files:
 *     - path/a
 *     - path/b
 */
function collectBulletList(text, markerPattern, _label) {
  const markerMatch = text.match(markerPattern);
  if (!markerMatch) return [];
  const startIndex = markerMatch.index + markerMatch[0].length;
  const remainder = text.slice(startIndex);
  // Drop the leading blank line that comes right after the `- files:` marker
  // so we don't break out of the loop before seeing the first indented bullet.
  const lines = remainder.replace(/^\r?\n/, "").split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (!/^\s+-\s+/.test(line)) break;
    if (/^\s+-\s+\S+\s*:/.test(line)) break; // a sibling key like `- checks:`
    const value = line.replace(/^\s+-\s+/, "").trim();
    if (value) out.push(value);
  }
  return out;
}

const FILE_CLAIM_PATTERN = /^[ \t]*[-*]\s+(?:file|path|file:\s*|`?file`?)[`: ]+\s*`?([^`\n]+?)`?\s*$/gim;

/**
 * Best-effort extraction of "files the model claims to have changed" out of
 * the free-form text. We accept a few common conventions the model might use
 * (markdown bullets, backticked paths, or a `File:` prefix). Anything we
 * successfully parse is returned in the order it appeared; dedup happens
 * downstream if needed.
 */
export function parseClaimedFiles(text) {
  if (typeof text !== "string" || text.trim() === "") return [];
  const out = [];
  const seen = new Set();
  FILE_CLAIM_PATTERN.lastIndex = 0;
  let match;
  while ((match = FILE_CLAIM_PATTERN.exec(text)) !== null) {
    const candidate = match[1].trim();
    if (!candidate || candidate.includes(" ")) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}

function buildTruncationWarnings(truncated, droppedBytes, prefix) {
  const warnings = [];
  if (!truncated) return warnings;
  for (const stream of ["stdout", "stderr"]) {
    if (truncated[stream]) {
      const bytes = droppedBytes?.[stream] ?? 0;
      warnings.push(`${prefix}-${stream}-truncated-dropped-${bytes}b`);
    }
  }
  return warnings;
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
