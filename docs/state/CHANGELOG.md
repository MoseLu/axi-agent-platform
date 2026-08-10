# Changelog

All notable changes to **Axi Agent Platform** are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Added a `task-execution-routing/v1` boundary: the legacy Agent APIs now
  consume only signed, read-only `bounded_agent` routes, emit authenticated
  minimal lifecycle events, and turn all direct command/write/effect paths
  into workflow or approval requirements.
- `apps/desktop-glass-ui` as the migrated macOS glass desktop shell prototype for Axi Agent Platform.
- Initial `docs/INDEX.md`, `docs/PRD.md`, and `docs/TDD.md` produced by the workspace docs deep-init rollout (2026-06-08).
- Root-level `MILESTONE.md` and `TODO.md` for cross-module progress and requirement tracking.
- `docs/ADR/` directory reserved for future architectural decision records.
- `docs/axi-todo-prd-continuity-design.md` defining the planned Axi Todo PRD continuity ledger, provenance, checkpoint, audit, resume, and export model.

### Changed
- Upgraded `docs/project-docs.manifest.json` to the v2 zero-context onboarding contract and added ongoing freshness governance to `TODO.md`.

### Deprecated
- None.

### Removed
- None.

### Fixed
- None.

### Security
- None.

## [1.1.0] - 2026-05-25

### Added
- SubAgent code-development mode (Planner / Worker / Judge three-tier roles).
- `CodeIsolationManager` for Git worktree-based parallel code environments.
- SubAgent REST surface (`/subagent/worktree/*` and `/subagent/quality/*`).
- `axi-agent-mcp` MCP swarm service as external model-routing, workflow, git, CI, agent, skill, governance, and data plane.
- Frontend SubAgent management page (`frontend/src/pages/SubAgent.tsx`).
- Repository renaming from experimental names to **Axi Agent Platform** (`axi-agent-platform-*`).

### Changed
- Default SQLite filename migrated from `agent_swarm.db` to `axi_agent_platform.db`.
- Container, network, and package names aligned to `axi-agent-platform-*` family.

## [1.0.0] - 2026-05-10

### Added
- FastAPI backend with OpenAI Swarm-style orchestration, LangChain tool integration, Chroma long-term memory.
- React 18 + TypeScript + Tailwind + Zustand + Recharts frontend with multi-page dashboard.
- Docker compose deployment for backend + frontend.
- General collaboration mode supporting up to 10 parallel agents, task scheduling, custom roles, capability tags, and tool/agent/memory management.

[Unreleased]: #unreleased
[1.1.0]: #110---2026-05-25
[1.0.0]: #100---2026-05-10
