# Axi Todo — Evidence Guardrails Test Plan

Companion doc for the A-segment change set landing in `tools/axi-todo/lib/{process,codex-runner,store,schema}.mjs`. Each guardrail gets one or more unit cases plus one end-to-end smoke test that exercises the full `executeTaskWithCodex → completeTask` flow.

Run order:

```bash
cd /Volumes/code/workspace/projects/axi-agent-platform
node --test tools/axi-todo/test/evidence-guardrails.test.mjs
node --test tools/axi-todo/test/*.test.mjs        # regression
```

End-to-end smoke is run manually and is **not** part of the regular `pnpm --dir tools/axi-todo verify` because it shells out to a real `codex` binary.

---

## A1 — `buildCodexPrompt` injects `rejectedApproaches` and `evidenceContract`

| # | Case | Input | Expected |
|---|---|---|---|
| 1.1 | Both empty | `task.rejectedApproaches = []`, `task.evidenceContract = ""` | No `## Rejected Approaches` or `## Evidence Contract` heading in prompt; existing `## Completion Contract` still mentions the Evidence section hard contract |
| 1.2 | `rejectedApproaches` only | `["Don't edit the daemon while it's running", "Don't bump the node version"]` | A `## Rejected Approaches` section with both bullets verbatim, in order |
| 1.3 | `evidenceContract` only | `"Report the changed files and the verification exit code"` | A `## Evidence Contract` section containing that exact text |
| 1.4 | Both | The two above combined | Both headings appear, `Rejected Approaches` comes **before** `Evidence Contract`, both **after** `## User Request` and **before** `## Completion Contract` |
| 1.5 | Junk values | `rejectedApproaches = ["", "  ", null, 42]` | All non-string / blank entries dropped silently; section omitted if nothing remains |

## A3 — `parseEvidenceSection` and `parseClaimedFiles` are machine-stable

| # | Case | Input | Expected |
|---|---|---|---|
| 3.1 | Well-formed block | `… done.\n\n## Evidence\n- claim: Fixed login.\n- files:\n  - src/auth.ts\n  - src/auth.test.ts\n- checks:\n  - pnpm test: 0 failures\n` | `{ missing: false, claim: "Fixed login.", files: ["src/auth.ts","src/auth.test.ts"], checks: ["pnpm test: 0 failures"], warnings: [] }` |
| 3.2 | Claim only, no files | `- claim: Updated docs.` | `missing: false`, `files: []` — `claim` alone is enough to satisfy the hard contract |
| 3.3 | Files only, no claim | `- files:\n  - x.ts` | `missing: false`, `files: ["x.ts"]` — `files:` alone is enough |
| 3.4 | Empty section | `## Evidence\n\n## Next Section` | `missing: true` (section is empty / no `claim` and no `files:`) |
| 3.5 | No heading at all | Plain text | `missing: true` |
| 3.6 | Section truncated at EOF | `## Evidence\n- claim: half` | `missing: false`, `claim: "half"` (no `files` required when `claim` present) |
| 3.7 | Sibling keys stop the bullet collector | `## Evidence\n- files:\n  - a\n  - b\n- checks:\n  - c\n` | `files: ["a","b"]`, `checks: ["c"]` (the `- checks:` line ends `files` collection cleanly) |
| 3.8 | `parseClaimedFiles` — backticked bullets | `- file: \`src/foo.ts\`` | `["src/foo.ts"]` |
| 3.9 | `parseClaimedFiles` — junk filtered | `Hello world\n- file: \` `, `a path with spaces` | Empty array (no `claimFile` matches because the value contains spaces or is empty) |
| 3.10 | `parseClaimedFiles` — dedup | Two lines pointing at the same path | One entry |

## A4 — `process.appendBounded` reports truncation truthfully

| # | Case | Input | Expected |
|---|---|---|---|
| 4.1 | Under limit | `current = "abc"`, `next = "de"`, `max = 10` | `{ text: "abcde", truncated: false, droppedBytes: 0 }` |
| 4.2 | Exactly at limit | `current = "abcde"`, `next = "12345"`, `max = 10` | `{ text: "abcde12345", truncated: false, droppedBytes: 0 }` |
| 4.3 | One byte over | `current = "abcde"`, `next = "123456"`, `max = 10` | `{ text: "cde123456", truncated: true, droppedBytes: 1 }` |
| 4.4 | Massive overflow | `current = ""`, `next = "x".repeat(200)`, `max = 64 * 1024` | `{ text: "x".repeat(64 * 1024), truncated: true, droppedBytes: 200 - 64 * 1024 }` (keeps the tail) |
| 4.5 | `runProcess` integration | Spawn `printf 'a'.repeat(200000)` with `maxBuffer: 1024` | `result.truncated.stdout === true`, `result.droppedBytes.stdout > 0`, `result.stdout.length === 1024` |

## A2 — `completeTask` guardrails

Set up: a real `TaskStore` pointed at `os.tmpdir()/axi-todo-test-<uuid>/tasks.json` plus a fixture `task` with known `evidenceContract` / `auditLevel`. Stub the `recordAuditReview` path by giving the store a fresh home so we can assert against the written JSON after the test.

| # | Case | Pre-conditions | Expected |
|---|---|---|---|
| 2.1 | Evidence OK, no contract | `evidenceContract = ""`, `evidenceMissing = false` | `task.status = "completed"`, `task.summary` contains no warning block, history event is `"completed"`, no `auditReviews` written |
| 2.2 | Evidence OK, contract present | `evidenceContract = "…"`, `result.evidenceMissing = false` | `task.status = "completed"`, no audit review written, no `task.evidenceMissing` flag |
| 2.3 | **Evidence missing, contract present, auditLevel=standard** | `evidenceContract = "report files"`, `result.evidenceMissing = true`, `result.auditLevel = "standard"` | `task.status = "awaiting_audit"`, `task.evidenceMissing = true`, `task.completedAt === undefined`, `task.error === "Evidence section missing in runner output"`, **one** `auditReviews` row with `verdict: "pending"`, history event is `"audit_waiting"` |
| 2.4 | Evidence missing, contract present, auditLevel=strict | Same as 2.3 but `auditLevel: "strict"` | Behaves the same as 2.3 (A-segment treats `strict` and `standard` identically — B-segment will tighten this) |
| 2.5 | Evidence missing, contract present, auditLevel=none | Same as 2.3 but `auditLevel: "none"` | `task.status = "completed"`, no audit review, but `task.evidenceMissing` is **not** set; warning block in summary includes `evidence-section-missing-in-last-message` |
| 2.6 | Claim files mismatch (auditLevel=none) | `claimFiles = ["nope.ts"]`, file does not exist on disk, `auditLevel = "none"` | `task.status = "completed"`, `task.summary` ends with `⚠️ axi-todo warnings:\n- claimed-file-missing: 1` (or similar), `task.history.last.data.claimedFileMismatches` includes `"nope.ts"`, `result.warnings` contains `"claimed-files-missing:1"` |
| 2.7 | Claim files OK | `claimFiles = ["exists.ts"]` (a real fixture file) | `task.status = "completed"`, no claim-mismatch warning, no audit review |
| 2.8 | Truncation surfacing | Runner hands back `result.truncated = { stdout: true, stderr: false, droppedBytes: { stdout: 4096, stderr: 0 } }`, no evidence contract | `task.status = "completed"`, `task.summary` contains `- runner-stdout-truncated-dropped-4096b` warning, no audit review |
| 2.9 | Gate interaction | `evidenceContract` set + evidence missing + truncation + claim mismatch (all in one run) | `task.status = "awaiting_audit"`; one audit review; **summary still gets the soft warning block** even though the task is held (operators want to see what the runner actually said) |
| 2.10 | Idempotency | Run `completeTask` twice for the same task with the same result | First call: status changes; second call: throws "unknown task" only if the task was deleted, otherwise `appendHistory` adds a second `audit_waiting` event but the audit review record is appended twice (acceptable — `auditReviews` is append-only planning memory) |

## End-to-end smoke (manual, requires real `codex` CLI)

Setup: `cwd = <git worktree of an Axi monorepo project>`, no daemon running, fake task that the model **can** answer (e.g. "Add a top-level header to `README.md` that reads '// smoke-test'"). Inspect `~/.axi-todo/tasks.json` and `<cwd>/VERIFICATION.md` afterwards.

| # | Case | Steps | Pass criteria |
|---|---|---|---|
| E.1 | Happy path | `verifyCommand = "head -n 5 README.md"`, no `evidenceContract` | Task ends `completed`, `VERIFICATION.md` shows one row with `status=passed` and `exit=0` |
| E.2 | Evidence gate fires | `evidenceContract = "report the file path you edited"`, prompt asks the model to skip the Evidence section by giving a very short `lastMessage` | Runner output truncated, `evidenceMissing = true`, task ends `awaiting_audit`, one `auditReviews` row with `verdict=pending` and `reason="Evidence section missing in runner output"` |
| E.3 | Truncation | `verifyCommand = "yes | head -c 200000"` | `VERIFICATION.md` row's `verification.warnings` (or summary tail in `tasks.json`) shows `runner-stdout-truncated-dropped-…b` |

---

## Implementation sketch for `test/evidence-guardrails.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { buildCodexPrompt, parseEvidenceSection, parseClaimedFiles } from "../lib/codex-runner.mjs";
import { runProcess } from "../lib/process.mjs";
import { TaskStore } from "../lib/store.mjs";

test("A1: buildCodexPrompt injects Rejected Approaches and Evidence Contract", () => {
  // cases 1.1, 1.2, 1.3, 1.4, 1.5
});

test("A3: parseEvidenceSection handles all shapes", () => {
  // cases 3.1 - 3.7
});

test("A3: parseClaimedFiles filters and dedups", () => {
  // cases 3.8 - 3.10
});

test("A4: appendBounded reports truncation and dropped bytes", async () => {
  // cases 4.1 - 4.4
});

test("A4: runProcess surfaces stdout truncation", async () => {
  // case 4.5: spawn a child that prints 200_000 bytes with maxBuffer 1024
});

test("A2: completeTask blocks completion on missing evidence", async () => {
  // create a temp home; cases 2.1 - 2.10
  // use real TaskStore against a temp file, then read tasks.json and assert
});
```

The end-to-end cases (E.1 / E.2 / E.3) are **not** written into the test file because they require a real Codex CLI. They are recorded here for human verification after each release.

---

## Acceptance criteria

1. All 24 existing tests still pass (`node --test tools/axi-todo/test/*.test.mjs`).
2. The new `evidence-guardrails.test.mjs` passes locally.
3. Manual E.1 / E.2 / E.3 succeed against a real Codex CLI in a git worktree.
4. `pnpm --dir tools/axi-todo verify` reports no new failures introduced by this change set.
5. At least one `auditReviews` row appears in the test JSON for case 2.3, 2.4, 2.9, 2.10, E.2 — proving the `recordAuditReview` round-trip works end-to-end.
