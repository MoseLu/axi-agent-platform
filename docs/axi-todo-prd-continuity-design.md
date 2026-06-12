# Axi Todo PRD Continuity Design

Status: Draft design
Owner: tools maintainer
Created: 2026-06-12

## Problem

Long-running PRD work can span hundreds of discussion turns and many model context windows. A model cannot be trusted to carry the product truth in memory across those boundaries. If the only continuity mechanism is chat history or a lossy summary, later turns can silently mix confirmed requirements, old decisions, guesses, and abandoned proposals.

The Axi Todo capability should make long-horizon PRD work restartable from local evidence. The model may help synthesize, but `axi-todo` must own the durable state, provenance, unresolved questions, decisions, and verification gates.

## Product Goal

Add a local-first `prd` mode to `axi-todo` that keeps a PRD project coherent across many sessions by rebuilding each new context from a compact, cited, machine-checkable evidence package.

The target user experience:

1. Start a PRD workspace from a goal.
2. Record every discussion turn, user decision, assumption, source file, and rejected option as append-only events.
3. Promote only audited claims into the canonical PRD.
4. Resume in a later session from a generated context pack instead of relying on model memory.
5. Detect contradictions, stale claims, unresolved questions, and uncited assertions before they pollute the PRD.

## Non-Goal

This does not guarantee that a model will never hallucinate. The system instead prevents hallucinated or unsupported claims from becoming canonical without a source, status, and audit trail.

## Core Principle

No source, no carry-forward.

Every durable PRD claim must have:

- `claimId`: stable id.
- `projectId`: PRD workspace id.
- `text`: the claim itself.
- `claimType`: requirement, constraint, decision, open_question, assumption, risk, rejected_option, glossary, interface_contract, milestone.
- `status`: proposed, confirmed, superseded, rejected, stale, needs_user.
- `sourceRefs`: one or more references to discussion events, files, command outputs, screenshots, docs, or user confirmations.
- `confidence`: 0 to 1, derived from source quality and audit state.
- `supersedes`: optional list of older claim ids.
- `createdAt` and `updatedAt`.

Only `confirmed` claims are allowed in the canonical PRD export. `proposed`, `assumption`, `needs_user`, and `stale` claims can appear in a separate review section.

## Data Model

Extend the existing `tasks.json` state shape with PRD-specific collections. Keep JSON as the default local store and mirror these collections in Postgres later only if the existing store adapter already supports it.

```json
{
  "prdProjects": [],
  "prdEvents": [],
  "prdClaims": [],
  "prdDecisions": [],
  "prdCheckpoints": [],
  "prdContextPacks": [],
  "prdAudits": []
}
```

### `prdProjects`

```json
{
  "id": "prd_...",
  "title": "Axi Todo PRD continuity",
  "cwd": "/Volumes/code/workspace/projects/axi-agent-platform",
  "status": "active",
  "canonicalPrdPath": "docs/prd/<slug>/PRD.md",
  "artifactRoot": "docs/prd/<slug>",
  "createdAt": "...",
  "updatedAt": "..."
}
```

### `prdEvents`

Append-only event stream. This is the raw continuity ledger.

```json
{
  "id": "event_...",
  "projectId": "prd_...",
  "turnId": "turn_...",
  "actor": "user|agent|tool|auditor",
  "eventType": "message|file_ref|decision|question|answer|audit|checkpoint|export",
  "summary": "User requires context-safe PRD work across hundreds of turns.",
  "contentHash": "sha256:...",
  "contentPath": "~/.axi-todo/prd/<project>/events/<event>.md",
  "refs": [],
  "createdAt": "..."
}
```

Large content belongs in files under `AXI_TODO_HOME/prd/<projectId>/events/`; the JSON ledger stores hashes and paths.

### `prdClaims`

The normalized requirement and decision graph. Claims are derived from events, not invented as standalone truth.

```json
{
  "id": "claim_...",
  "projectId": "prd_...",
  "claimType": "requirement",
  "text": "The PRD resume flow must rebuild context from local evidence, not chat memory.",
  "status": "confirmed",
  "sourceRefs": ["event_...", "decision_..."],
  "confidence": 0.92,
  "supersedes": [],
  "createdAt": "...",
  "updatedAt": "..."
}
```

### `prdCheckpoints`

Compaction boundaries. A checkpoint records the canonical state after a review pass.

```json
{
  "id": "checkpoint_...",
  "projectId": "prd_...",
  "sequence": 12,
  "summary": "Stable requirements after pricing-model discussion.",
  "confirmedClaimIds": [],
  "openQuestionIds": [],
  "staleClaimIds": [],
  "canonicalPrdHash": "sha256:...",
  "contextPackId": "ctx_...",
  "createdAt": "..."
}
```

### `prdContextPacks`

Generated resume payloads. These are the only context blobs a new model should trust at startup.

```json
{
  "id": "ctx_...",
  "projectId": "prd_...",
  "checkpointId": "checkpoint_...",
  "tokenBudget": 24000,
  "path": "~/.axi-todo/prd/<project>/context-packs/<ctx>.md",
  "includedClaimIds": [],
  "omittedClaimIds": [],
  "auditStatus": "passed",
  "createdAt": "..."
}
```

## Commands

Add CLI commands and matching MCP tools:

```bash
node bin/axi-todo.mjs prd init --title <title> --cwd <path>
node bin/axi-todo.mjs prd append --project <id> --actor user --file <message.md>
node bin/axi-todo.mjs prd extract --project <id>
node bin/axi-todo.mjs prd audit --project <id>
node bin/axi-todo.mjs prd checkpoint --project <id>
node bin/axi-todo.mjs prd resume --project <id> --token-budget 24000
node bin/axi-todo.mjs prd export --project <id> --output docs/prd/<slug>/PRD.md
```

MCP tools:

- `axi_todo_prd_init`
- `axi_todo_prd_append_event`
- `axi_todo_prd_extract_claims`
- `axi_todo_prd_audit`
- `axi_todo_prd_checkpoint`
- `axi_todo_prd_resume`
- `axi_todo_prd_export`

## Resume Algorithm

`prd resume` builds a context pack in this order:

1. Load the latest passed checkpoint.
2. Include project charter, scope, non-goals, glossary, confirmed decisions, active constraints, open questions, and recent unresolved events.
3. Include only claims with valid `sourceRefs`.
4. Mark stale or conflicting claims separately.
5. Include a "do not assume" section listing rejected options and unresolved questions.
6. Emit source ids beside every claim.
7. Fail the resume pack if any canonical section contains uncited claims.

The generated pack should be explicit about what is known, what changed, what is unresolved, and what must not be reintroduced.

## Hallucination Controls

### 1. Provenance Gate

Any claim promoted into the canonical PRD must cite at least one event or source artifact. Claims without source refs stay in `proposed` status.

### 2. State Labels

The UI and CLI must distinguish:

- Confirmed: user-approved or source-backed.
- Proposed: model suggestion not accepted yet.
- Assumption: useful working hypothesis.
- Needs user: blocked on user decision.
- Rejected: explicitly ruled out.
- Superseded: replaced by a newer claim.
- Stale: contradicted by newer evidence.

### 3. Conflict Scan

`prd audit` checks for:

- Same claim type with conflicting values.
- Confirmed claims that cite missing events.
- New claims that contradict rejected options.
- Canonical PRD text that has no claim id marker.
- Open questions that are referenced as if resolved.

### 4. Promotion Rules

Model output can create `proposed` claims. Only these actions can promote to `confirmed`:

- Direct user confirmation in a later event.
- A source file or command output that proves the claim.
- A checkpoint audit that records why the claim is safe.

### 5. Context Budget Discipline

Context packs are generated from the claim graph, not raw chat. Older events are summarized only through cited claims and checkpoints. Raw events remain retrievable by id.

### 6. Tombstones

Rejected and superseded claims are kept as tombstones so future agents do not rediscover and re-propose discarded ideas.

## File Artifacts

For each PRD project:

```text
~/.axi-todo/prd/<projectId>/
  events/
  context-packs/
  exports/
  audits/
```

Recommended repository artifacts:

```text
docs/prd/<slug>/PRD.md
docs/prd/<slug>/DECISIONS.md
docs/prd/<slug>/QUESTIONS.md
docs/prd/<slug>/TRACE.json
```

`TRACE.json` maps canonical PRD sections back to `prdClaims` and `prdEvents`.

## Canonical PRD Format

Each canonical PRD section should carry hidden or visible claim markers:

```md
## Requirements

### R-001 Resume from local evidence

The system must rebuild a new session from an audited context pack, not from model memory.

Trace: claim_123, event_456
```

Exports should fail when a requirement lacks a trace marker.

## UI Shape

Desktop app additions:

- PRD project list.
- Active context pack summary.
- Claim table with status, confidence, source count, and last updated time.
- Open questions view.
- Decision log view.
- Conflict/audit panel.
- Export button disabled until audit passes.

## Implementation Phases

### Phase 1: Local ledger and CLI

- Add schema normalization for PRD collections.
- Add store methods for projects, events, claims, checkpoints, context packs, and audits.
- Add CLI `prd init`, `prd append`, `prd resume`, and `prd export`.
- Add tests around append-only events, source refs, and resume pack generation.

### Phase 2: Claim extraction and audit

- Add deterministic claim promotion and audit rules.
- Add `prd extract` as a model-assisted step whose output is still validated by local rules.
- Add conflict detection tests.

### Phase 3: MCP and desktop

- Expose PRD tools through MCP.
- Add desktop PRD continuity views.
- Add export and audit status to the UI.

### Phase 4: Repository integration

- Allow tasks to attach to a `prdProjectId`.
- Allow `split` to create tasks from confirmed PRD requirements only.
- Write verification evidence back to PRD claims when implementation tasks complete.

## Acceptance Criteria

- A PRD project can be resumed after deleting model context and restarting Codex.
- The resume pack contains only cited canonical claims plus clearly labeled unresolved items.
- Export fails if canonical PRD text contains uncited requirements.
- Rejected ideas remain visible as tombstones and are not reintroduced as active requirements.
- `pnpm --dir tools/axi-todo verify` passes with tests covering PRD store normalization, append-only event capture, context-pack generation, and audit failure cases.

## Open Questions

- Whether PRD events should default to JSON-only storage or file-backed event bodies from the first implementation.
- Whether user confirmation should be represented as a special event type or as an audit review.
- Whether desktop PRD editing should be allowed in phase 1 or kept CLI/MCP-only until the trace model is stable.
