# 2026-02 Pre-Restart Archive

These 13 documents capture the **pre-restart state of `axi-agent-mcp`** as
of 2026-02-25, immediately before the migration that moved the swarm MCP
service into the Axi Agent Platform repository and split it into the
current `src/index.ts` / `src/tool-contract.ts` layout with capability broker
guards.

The directory is intentionally retained (rather than deleted) so historical
references — Wave 1 closeout reports, original `MCP_INTEGRATION_REPORT.md`,
`PHASE3_COMPLETION_REPORT.md`, `INDUSTRIAL_UPGRADE.md` — remain traceable
from external links and pre-2026-04 retro docs.

## Contents (13 files)

- `DATABASE_SETUP_GUIDE.md` — pgvector bootstrap README, 2026-02-25
- `ENHANCEMENT_COMPLETION_REPORT.md` — enhancement roll-up, 2026-02-25
- `FILE_OPERATIONS_GUIDE.md` — file-tools user guide, 2026-02-25
- `FINAL_COMPLETION_REPORT.md` — phase-3 final report, 2026-02-25
- `IMPLEMENTATION_PROGRESS.md` — implementation tracker, 2026-02-25
- `INDUSTRIAL_UPGRADE.md` — industrial-quality upgrade narrative, 2026-02-25
- `MCP_INTEGRATION_REPORT.md` — integration test report, 2026-02-25
- `MIDTERM_COMPLETION_REPORT.md` — phase-2 closeout, 2026-02-25
- `PHASE3_COMPLETION_REPORT.md` — phase-3 closeout, 2026-02-25
- `REPAIR_STATUS.md` — runtime repair status snapshot, 2026-02-25
- `TEST_REPORT_01.md` — initial smoke test report, 2026-02-25
- `WORKFLOW_GUIDE.md` — workflow authoring guide, 2026-02-25
- `WORKSPACE_ANALYSIS_REPORT.md` — workspace cross-impact analysis, 2026-02-25

## Reactivation / deletion policy

- **Do not edit** any file in this archive. They are immutable historical snapshots.
- To reactivate a guidance doc, copy the relevant content into the current
  repo (e.g. into `docs/` or `infra/axi-agent-mcp/docs/USER_GUIDE.md`) and
  update links from this archive.
- To delete the entire archive (owner-only decision), first verify no
  external docs link to these filenames.

## Provenance

Archived by the M18 doc-cleanup wave (2026-10-11). Prior location:
`infra/axi-agent-mcp/*.md` (mixed with current README files).
