import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  AXI_AGENT_MCP_TOOL_GROUPS,
  AXI_AGENT_MCP_TOOLS,
  getAxiAgentMcpTool,
  listAxiAgentMcpTools,
} from "./tool-contract.js";

function registeredToolNames(): string[] {
  const sourcePath = join(dirname(fileURLToPath(import.meta.url)), "index.ts");
  const source = readFileSync(sourcePath, "utf8");
  return [...source.matchAll(/registerTool\(\s*\n\s*"([^"]+)"/g)].map((match) => match[1]);
}

describe("Axi Agent MCP tool contract", () => {
  it("classifies every registered MCP tool exactly once", () => {
    const registered = registeredToolNames();
    const duplicateRegistered = registered.filter((name, index) => registered.indexOf(name) !== index);
    const contracted = AXI_AGENT_MCP_TOOLS.map((tool) => tool.name);
    const duplicateContracted = contracted.filter((name, index) => contracted.indexOf(name) !== index);

    expect(duplicateRegistered).toEqual([]);
    expect(duplicateContracted).toEqual([]);
    expect([...contracted].sort()).toEqual([...registered].sort());
  });

  it("keeps mutating tools visible to the runtime owner", () => {
    const mutatingTools = listAxiAgentMcpTools().filter((tool) => tool.mutatesWorkspace);

    expect(mutatingTools.map((tool) => tool.name).sort()).toEqual([
      "swarm_autofix_lint",
      "swarm_git_commit",
      "swarm_git_create_branch",
      "swarm_modify_file",
      "swarm_vector_upsert",
      "swarm_write_file",
    ]);
  });

  it("exposes runtime groups for Axi Agent Platform integration", () => {
    expect(AXI_AGENT_MCP_TOOL_GROUPS.map((group) => group.id)).toEqual([
      "model-routing",
      "workflow",
      "workspace",
      "git",
      "ci",
      "agents",
      "skills",
      "governance",
      "data",
    ]);
    expect(getAxiAgentMcpTool("swarm_git_commit")?.groupId).toBe("git");
    expect(listAxiAgentMcpTools("governance").map((tool) => tool.name)).toEqual([
      "swarm_list_gates",
      "swarm_validate_with_gates",
    ]);
  });
});
