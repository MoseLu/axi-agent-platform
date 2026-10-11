# Retroactive Documentation: M17 Commit Trailer Normalization Gap

- Repository: `/Volumes/code/workspace/agent-cluster/axi-agent`
- Observed: 2026-10-10
- Subject HEAD SHA: `429273e3de5b3b58a1792fafe21f5a84590966b4`
- Owner directive source: remediation tasking from 2026-10-10 audit cycle

## Observed Violations on Subject HEAD

| Field | Observed value | Lore limit | Status |
|------|-----------------|-----------|--------|
| Subject length | 144 bytes | 72 bytes | over by 72 |
| Trailer `Tested:` | contains `;` (shell metacharacter) | plain | violation |
| Trailer `Not-tested:` | contains `;` (shell metacharacter) | plain | violation |
| Trailer `Confidence:` | contains `;` (shell metacharacter) | plain | violation |
| Trailer `Scope-risk:` | contains `;` (shell metacharacter) | plain | violation |
| Trailer `Directive:` | contains `;` (shell metacharacter) | plain | violation |

Totals: 1 subject length violation, 5 trailer metacharacter violations, 6 violations total across the historical commit message.

## Retrospective Note

The previous HEAD (429273e3) had a subject length over 72 and shell metacharacters in trailers; per retrospective on 2026-10-10, we accept the historical commit and document the gap rather than rewrite history. The audit explicitly forbids amend on this SHA because:

1. The commit subject itself anticipates the recursion: `M17.S99 SHA not recursively embedded to avoid amend-recursion`. An amend would re-trigger the same parser and re-flag the same violations until either the subject shrinks or `;` is removed from every trailer — both of which would alter historical evidence captured by OWNER_DECISIONS.md, `m17-entries.json`, the auto-submit log files in `docs/logs/submit/`, and the audit summary ledger at `foundation/workspace-governance/...`.
2. Eight subagent fix-wave commits and eight OD sections in `OWNER_DECISIONS.md` already cite the exact SHA. Rewriting it would orphan every cross-reference.

## Lore Trailers For This Retroactive Documentation Commit

- Tested: grep -c ';' on (429273e3) commit message returns the known violations
- Not-tested: full re-run of M17 SOP replay
- Confidence: high
- Scope-risk: documentation only
- Directive: keep local branch and do not merge main or push

## Resolution Path Forward

Future milestones are expected to follow the `chore(<scope>):` subject convention, keep subjects ≤ 72 bytes, and keep all five Lore trailers free of shell metacharacters so the `pre-commit` and `commit-msg` hooks in `.githooks/` accept them at write time. The historical commit remains in place; this note is the canonical reference for the historical gap.
