# Axi Agent MCP Service Contract

Generated: 2026-05-25

## Purpose

`axi-agent-mcp` is the MCP service owner for Axi Agent. `axi-agent-platform` consumes this service as an external tool/service layer; it must not copy model routing, workflow execution, filesystem, git, CI, agent, skill, gate, vector, cache, or code-store implementations into the platform runtime.

The local service/package path has been renamed from `mcp-swarm` to `axi-agent-mcp`. MCP tool names keep the `swarm_*` prefix for compatibility with existing callers.

## Runtime Groups

| Group | Owner | Runtime consumer | Tool surface |
|---|---|---|---|
| `model-routing` | `axi-agent-mcp` | `axi-agent-platform` | `swarm_chat`, `swarm_chat_with_model`, `swarm_analyze_task`, stats, metrics, logs, circuit breaker |
| `workflow` | `axi-agent-mcp` | `axi-agent-platform` | Workflow execute/list/validate/recommend catalog |
| `workspace` | `axi-agent-mcp` | `axi-agent-platform` | Files, directory listing, code search, index, workspace analysis, tech-stack detection, file locks |
| `git` | `axi-agent-mcp` | `axi-agent-platform` | Status, commit, branch creation, merge-request description |
| `ci` | `axi-agent-mcp` | `axi-agent-platform` | Lint, tests, lint autofix |
| `agents` | `axi-agent-mcp` | `axi-agent-platform` | Agent catalog, recommendation, dynamic roles, swarm execution |
| `skills` | `axi-agent-mcp` | `axi-agent-platform` | Skill catalog and execution |
| `governance` | `axi-agent-mcp` | `axi-agent-platform` | Quality gates and validation |
| `data` | `axi-agent-mcp` | `axi-agent-platform` | DB stats, vector search/upsert, cache stats, code stats |

## Integration Rules

- `axi-agent-platform` should call this service through MCP for these groups instead of importing or duplicating implementations.
- Mutating tools are explicitly marked in `src/tool-contract.ts`; platform callers must apply project/worktree guardrails before calling them.
- External API tools must receive credentials through the service environment, not through persisted platform task payloads.
- The prior duplicate registration name `swarm_list_workflows` has been split: built-in workflow templates keep `swarm_list_workflows`; recommender catalog listing is `swarm_list_workflow_catalog`.
- Remote repository names are not changed in this local phase. Local paths, package names, docs, and registry names now use `axi-agent-mcp`.

## Verification

The contract is executable:

- `src/tool-contract.ts` lists groups and all MCP tool names.
- `src/tool-contract.test.ts` extracts `server.registerTool(...)` names from `src/index.ts`, rejects duplicate registrations, and checks every registered tool is classified exactly once.
