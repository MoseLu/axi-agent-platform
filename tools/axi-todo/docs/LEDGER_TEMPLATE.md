# Axi Todo — Milestone Ledger Template

> **Purpose**: Formalize the minimum-required-fields schema for every top-level key in the per-milestone ledger files under `.m1-snapshot/ledger/m{N}-entries.json`.
>
> **Why this exists**: M10 Track C identified 4 schema-drift candidates across M1-M11 ledgers (loreTrail string→object M6→M7, newFindings string→object M6→M7, ownerDecisionsRequired 5 field-shape variants, subTasks M6 dropped `deps` field). All four share a single root cause: the milestone ledger template was never formalized. Each milestone made up its own shape as it needed richer fields. M12 Track A audit confirmed zero automated readers (grep over `lib/`, `bin/`, `test/`, `scripts/`, `Sources/`, `src/` returns 0 hits for any ledger key — pure human/agent metadata). This doc declares the schema; future milestone work inherits it automatically.

---

## Top-level keys (13 keys)

| Key | Type | Required? | Form (M12+) |
|---|---|---|---|
| `milestoneId` | string | yes | `"TODO-milestone-id"` (placeholder; resolve at write time) |
| `milestoneStatus` | enum | yes | `"implementation-complete"` \| `"in-progress"` \| `"blocked"` |
| `verificationStatus` | string | yes | free-form status string; `"Locally verified; awaiting owner acceptance"` is the standard close-state |
| `milestoneTitle` | string | yes | `"M{N}: <one-line summary>"` |
| `milestoneAcceptance` | string[] | yes | one bullet per subTask; what was achieved + evidence ref |
| `subTasks` | object[] | yes | see SubTask schema below |
| `loreTrail` | object[] | no (M1/M2 omitted) | M3-M6: bare string `"<sha> <subject>"`; M7+: object `{sha, scope, track, subject}` |
| `newFindings` | string[] \| object[] | no (M3+ empty array) | M1/M2/M6: bare prose strings; M7+: object `{id, subject, detail, discovered_by, [resolution]}` |
| `ownerDecisionsRequired` | object[] | no (M1 omitted, M3+ empty array) | see OwnerDecision schema below |
| `closedDecisions` | object[] | no (M2 introduced) | array of resolution entries (id + summary + resolved_at + resolved_by; optional rationale) |
| `outOfScopeButFlagged` | string[] | no (M3+) | one-line per out-of-scope item + reason for not addressing |
| `sourceFindings` | string[] | no (M10+) | audit-style findings with file:line evidence |
| `subagentTracks` | object[] | no (M6+) | one per parallel subagent track: `{id, title, scope, filesTouched[], branch, outcome}` |

**Empty arrays vs absent keys**: prefer `"key": []` over absent (forward-compatibility with future parsers).

---

## SubTask schema

```json
{
  "tag": "M{N}.S{nn}",                       // required; dot-separated milestone + sub-task number
  "id": "TODO-m{N}-s{nn}-id",                // required; TODO-tracking id (placeholder ok)
  "trackTitle": "...",                       // optional (M6+, used per parallel-track subTask — see note)
  "status": "completed" | "in-progress",     // required
  "completedAt": "YYYY-MM-DD",               // required when status=completed
  "evidence": "...",                         // required; concrete ref (commit SHA, file:line, or subagent output)
  "deps": ["M{N}.S{nn}", ...]                // required for non-root subTasks; see Deps convention below
}
```

**Deps convention**:
- **Root subTask (`M{N}.S1`)**: MAY omit `deps` (M7+ pattern) OR use `"deps": []` (M1-M5 pattern). Both are semantically valid.
- **Non-root subTasks**: MUST declare `deps` — typically `["M{N}.S1"]`.
- **Close subTask (`M{N}.S99`)**: MUST declare `deps` on every preceding subTrack it gates. Example: `["M{N}.S2", "M{N}.S3", "M{N}.S4", "M{N}.S5", "M{N}.S6"]`.

**Historical note**: M6 abandoned `deps` entirely (7 subTasks × 0 `deps` occurrences in `m6-entries.json`). M12 restored it for M6.S1/S2-S6/S99 only — no other M6 subTask needs `deps` because they are single-task subTracks (S1 = close-gate, S2-S6 = independent parallel tracks).

---

## OwnerDecision schema (5 acceptable field shapes)

| Field | Type | When required |
|---|---|---|
| `id` | string | always — globally unique across all ledgers |
| `subject` | string | M7+ style — short title, ≤80 chars |
| `summary` | string | M5/M6 style — short summary; superseded by `subject` in M7+ |
| `detail` | string | M7+ style — full context |
| `discovered_by` | string | M7+ style — which subagent track / milestone surfaced the decision |
| `options` | string[] | M5/M6 style — when the decision has discrete operator choices |
| `default` | string | M5/M6 style — recommended default option text |
| `risk` | string | M5 only — for irreversible ops |
| `scope` | string | M10+ style — operator-action / cross-repo / design / acceptance-sweep |
| `resolution` | object | when closing — `{resolved: bool, resolved_at: ISO-8601 date, resolved_by: string, rationale: string}` |
| `linked_decisions` | string[] | M10+ OD-DELEGATE pattern — IDs of decisions delegated to OWNER_DECISIONS.md |
| `linked_doc` | string | M10+ OD-DELEGATE pattern — path to canonical doc |
| `eviction_status` | string | M12+ style — see OWNER_DECISIONS.md §"Decision Eviction Policy" Component 2 for vocabulary (`pending` / `closed` / `superseded` / `owner-no-action` / `out-of-scope` / `candidate-superseded-by-deferral` / `candidate-superseded-by-implicit-acceptance`) |

**Minimum required fields**: `id`, `subject` (or `summary` for legacy M5/M6 style), and at least one of `detail` or `options`.

**Eviction status (M12+)**: every entry SHOULD also carry an `eviction_status` field per the Decision Eviction Policy (see `OWNER_DECISIONS.md`). Values: `pending` | `closed` | `superseded` | `owner-no-action` | `out-of-scope` | `candidate-superseded-by-deferral` | `candidate-superseded-by-implicit-acceptance`. Required fields per value are documented in the canonical doc. The `OD-M{N}-DELEGATE` meta-deferral pattern intentionally omits `eviction_status` (see `OWNER_DECISIONS.md` "M12 application" for the documented exception).

---

## loreTrail form-transition (intentional)

- **M1/M2**: `loreTrail` absent. M1 used `evidence:` blob per subtask; M2 used top-level `commits[]` array.
- **M3-M6**: `loreTrail` is bare string array: `"<sha> <subject>"`.
- **M7+**: `loreTrail` is object array: `{sha: string, scope: "axi-todo"|"governance", track: string, subject: string}`.

The M6→M7 migration was deliberate — M7 introduced `scope` to distinguish governance-repo vs axi-todo-repo commits (M7.S2 commit `72d30d9` lives on `feature/audit-docs` in workspace-governance). No normalization required; do NOT rewrite M3-M6 entries.

---

## newFindings form-transition (intentional)

- **M1/M2/M6**: `newFindings` is bare prose strings (one sentence or paragraph each).
- **M7+**: `newFindings` is object array: `{id, subject, detail, discovered_by, [resolution]}`.

The M6→M7 migration was deliberate — M7 introduced `id` so cross-milestone references work (e.g. M9 references `M8-NEWFINDING-2/3` by id; M11 references `TODO-m6-track-5` for bookkeeping-gap closure). No normalization required.

**Id-naming convention** (M7+): prefix is **discovery milestone**, not residence milestone. `M8-NEWFINDING-1/2/3` were discovered in M8 (per `discovered_by: "M8 Track D summary audit"`) but their first-residence milestone was M7 (they appear in `m7-entries.json` newFindings[]). The prefix signals when the finding was first observed, not where it lives.

---

## `trackTitle` field (M6+, optional, used per parallel-track subTask)

`trackTitle` first appeared on M6 subTask entries (`m6-entries.json:27, 36, 45, 54, 63, 72` — S1/S2/S3/S4/S5/S6; M6.S99 omitted per M6 abandoned-`deps` historical pattern) as a human-readable track title. From M7 onward, every parallel-track milestone also uses it: M7 (4), M8 (5), M10 (6), M11 (4), M12 (7), M13 (1) — 33 `trackTitle` occurrences across M6-M13. `trackTitle` complements `loreTrail[].track` (which holds short track-id like `"M7.S2"`) by giving each track a descriptive label. Single-track milestone (M1, M2, M3, M4, M5, M9) typically omits it.

---

## Pre-M12 ledgers — leave as-is

Per M12 Track A recommendation: do NOT migrate M1-M11 ledgers to the M12+ schema. The forms are stable, the consumers are zero, and rewriting historical data is net-destructive. M13+ ledgers follow this template from creation; M1-M11 remain historical artifacts.

---

**Last updated**: 2026-10-02 (M12 Track A remediation)
**Authoritative location**: `tools/axi-todo/docs/LEDGER_TEMPLATE.md` (this file)
**Companion doc**: `tools/axi-todo/OWNER_DECISIONS.md` (Decision Eviction Policy + canonical owner-decision index)
