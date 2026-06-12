# Documentation Index

This file is the canonical map of human-authored and machine-authored documents inside the Axi Agent Platform monorepo. Use it before opening a doc to confirm ownership and source of truth.

## Root documents

| Path | Owner | Purpose | Source of truth? |
|------|-------|---------|------------------|
| `README.md` | project root | Source (Chinese) product entrypoint, quick start, architecture, SubAgent mode overview. | yes |
| `README.zh-CN.md` | project root | Simplified Chinese identity mirror of `README.md` (with i18n note header per workspace i18n policy). | mirror of `README.md` |
| `AGENTS.md` | project root | Root-level agent rules, project boundaries, authoritative source list, mandatory read order for new agents. | yes |
| `CHANGELOG.md` | project root | Keep-a-Changelog style release history. | yes |
| `TODO.md` | project root | P0/P1/P2 tasks with requirement IDs (`AXI-AP-<AREA>-<NN>`) and test cases for P0/P1. | yes |
| `MILESTONE.md` | project root | Evidence-backed milestone and current status. | yes |
| `INDEX.md` | project root | This document — doc map and ownership registry. | yes |
| `SECURITY.md` | project root | Security reporting policy. | yes |
| `BUG_FIXES.md` | project root | Historical bug-fix log. | reference only |
| `UPGRADE_v1.1.0.md` | project root | v1.1.0 SubAgent upgrade narrative (source language: Chinese). | yes |
| `UPGRADE_v1.1.0.zh-CN.md` | project root | Identity mirror of `UPGRADE_v1.1.0.md`. | mirror |
| `升级方案.md` | project root | Long-form v1.x upgrade plan in Chinese. | yes (historical) |
| `upgrade-plan.zh-CN.md` | project root | Identity mirror of `升级方案.md`. | mirror |
| `参考.md` | project root | Reference notes for upstream products and inspiration (third-party / reference governance). | reference only |

## `docs/` documents

| Path | Owner | Purpose | Source of truth? |
|------|-------|---------|------------------|
| `docs/PRD.md` | docs-agent | Product requirements: users, acceptance criteria, non-goals. | yes |
| `docs/TDD.md` | docs-agent | Test / technical design: architecture assumptions, test strategy, verification commands, risk cases. | yes |
| `docs/project-docs.manifest.json` | docs-agent | Machine-readable doc inventory, owners, and verification policy. | yes |
| `docs/ADR/` | architects | Architectural decision records (initialised 2026-06-08; first ADRs pending). | yes |
| `docs/audit/` | docs-agent | Doc-gap audit snapshots (consumed by deep-init rollout). | reference only |
| `docs/logs/` | platform runtime | Operational logs (not a documentation deliverable). | no |

## Module documents

| Path | Owner | Purpose | Source of truth? |
|------|-------|---------|------------------|
| `backend/` | backend maintainer | Python FastAPI source. Sub-module AGENTS lives under `backend/app/AGENTS.md` (if present). | yes |
| `frontend/` | frontend maintainer | React + TypeScript source. | yes |
| `apps/desktop-glass-ui/README.md` | desktop app maintainer | macOS glass desktop shell prototype, local Vite preview, and Electron packaging notes. | yes |
| `infra/axi-agent-mcp/README.md` | MCP swarm owner | MCP service overview. | yes |
| `infra/axi-agent-mcp/README.zh-CN.md` | MCP swarm owner | Identity mirror. | mirror |
| `infra/axi-agent-mcp/docs/axi-agent-mcp-service-contract.md` | MCP swarm owner | Runtime groups, tool surface, integration rules — cross-project boundary contract. | yes |
| `infra/axi-agent-transport/` | transport owner | HTTP / WebSocket transport bridge. | yes |
| `infra/codex-remote-bridge/` | bridge owner | Codex remote bridge runtime. | yes |
| `tools/axi-todo/README.md` | Axi Todo owner | Local persistent task ledger and Codex runner. | yes |
| `tools/axi-todo/package.json` | Axi Todo owner | Package manifest; defines `axi-todo`, `axi-todo-daemon`, `axi-todo-mcp`, `axi-todo-launchd` bins and `verify` script. | yes |

## Read order for new agents

1. `AGENTS.md` (project boundary + read order).
2. `README.md` or `README.zh-CN.md` (product surface).
3. `UPGRADE_v1.1.0.zh-CN.md` (SubAgent mode overview).
4. `infra/axi-agent-mcp/README.zh-CN.md` (MCP swarm surface).
5. `INDEX.md` (this file).
6. `docs/PRD.md` and `docs/TDD.md` (requirements and design).
7. `TODO.md` and `MILESTONE.md` (current state).
8. `CHANGELOG.md` (release history).

## Governance

- This `INDEX.md` is the authoritative doc map. When you add a new top-level document, register it here in the same commit that adds the file.
- Doc files tagged **mirror** must not diverge from their source in body content; only an i18n note header may differ.
- Reference / third-party governance docs (`参考.md`, `docs/audit/`, etc.) must not be promoted to source-of-truth status without an explicit ADR.
