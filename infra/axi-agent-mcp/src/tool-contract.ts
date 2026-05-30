export const AXI_AGENT_MCP_TOOL_GROUPS = [
  {
    id: "model-routing",
    label: "Model Routing",
    owner: "axi-agent-mcp",
    runtimeConsumer: "axi-agent-platform",
    description: "Model selection, chat execution, circuit breakers, cost, metrics, and logs.",
  },
  {
    id: "workflow",
    label: "Workflow",
    owner: "axi-agent-mcp",
    runtimeConsumer: "axi-agent-platform",
    description: "Built-in workflow execution, workflow validation, and workflow recommendation catalog.",
  },
  {
    id: "workspace",
    label: "Workspace",
    owner: "axi-agent-mcp",
    runtimeConsumer: "axi-agent-platform",
    description: "File, search, code index, tech-stack, workspace analysis, and file-lock operations.",
  },
  {
    id: "git",
    label: "Git",
    owner: "axi-agent-mcp",
    runtimeConsumer: "axi-agent-platform",
    description: "Repository status, commit, branch, and merge-request description helpers.",
  },
  {
    id: "ci",
    label: "CI",
    owner: "axi-agent-mcp",
    runtimeConsumer: "axi-agent-platform",
    description: "Lint, test, and autofix runners.",
  },
  {
    id: "agents",
    label: "Agents",
    owner: "axi-agent-mcp",
    runtimeConsumer: "axi-agent-platform",
    description: "Agent catalog, agent recommendations, dynamic agent role generation, and swarm execution.",
  },
  {
    id: "skills",
    label: "Skills",
    owner: "axi-agent-mcp",
    runtimeConsumer: "axi-agent-platform",
    description: "Skill catalog and skill execution surface.",
  },
  {
    id: "governance",
    label: "Governance",
    owner: "axi-agent-mcp",
    runtimeConsumer: "axi-agent-platform",
    description: "Quality gates and response validation.",
  },
  {
    id: "data",
    label: "Data",
    owner: "axi-agent-mcp",
    runtimeConsumer: "axi-agent-platform",
    description: "Database stats, vector search/upsert, cache stats, and code-store stats.",
  },
] as const;

export type AxiAgentMcpToolGroupId = (typeof AXI_AGENT_MCP_TOOL_GROUPS)[number]["id"];

export interface AxiAgentMcpToolContract {
  name: string;
  groupId: AxiAgentMcpToolGroupId;
  mutatesWorkspace?: boolean;
  requiresExternalApi?: boolean;
  requiresCredential?: boolean;
  description: string;
}

export const AXI_AGENT_MCP_TOOLS: AxiAgentMcpToolContract[] = [
  {
    name: "swarm_chat",
    groupId: "model-routing",
    requiresExternalApi: true,
    requiresCredential: true,
    description: "Auto-select a model and execute a chat request.",
  },
  {
    name: "swarm_chat_with_model",
    groupId: "model-routing",
    requiresExternalApi: true,
    requiresCredential: true,
    description: "Execute a chat request with a caller-selected model.",
  },
  { name: "swarm_analyze_task", groupId: "model-routing", description: "Analyze task type and recommended model without calling the API." },
  { name: "swarm_get_stats", groupId: "model-routing", description: "Return cost, model usage, and error statistics." },
  { name: "swarm_reset_circuit_breaker", groupId: "model-routing", description: "Reset model circuit-breaker state." },
  { name: "swarm_get_metrics", groupId: "model-routing", description: "Return latency and success-rate metrics." },
  { name: "swarm_get_logs", groupId: "model-routing", description: "Return recent in-process logs." },

  { name: "swarm_execute_workflow", groupId: "workflow", requiresExternalApi: true, description: "Execute a built-in or custom workflow." },
  { name: "swarm_list_workflows", groupId: "workflow", description: "List built-in workflow templates." },
  { name: "swarm_validate_workflow", groupId: "workflow", description: "Validate a custom workflow definition." },
  { name: "swarm_list_workflow_catalog", groupId: "workflow", description: "List workflow recommendation catalog entries by category." },
  { name: "swarm_recommend_workflow", groupId: "workflow", description: "Recommend the best workflow for a task." },

  { name: "swarm_read_file", groupId: "workspace", description: "Read a file under a project root." },
  { name: "swarm_write_file", groupId: "workspace", mutatesWorkspace: true, description: "Write a file under a project root." },
  { name: "swarm_modify_file", groupId: "workspace", mutatesWorkspace: true, description: "Modify a file under a project root." },
  { name: "swarm_list_directory", groupId: "workspace", description: "List a directory under a project root." },
  { name: "swarm_search_files", groupId: "workspace", description: "Search files by glob or text pattern." },
  { name: "swarm_search_code", groupId: "workspace", description: "Search code through the codebase index." },
  { name: "swarm_build_index", groupId: "workspace", description: "Build or rebuild a codebase index." },
  { name: "swarm_analyze_workspace", groupId: "workspace", description: "Analyze workspace structure and project signals." },
  { name: "swarm_detect_tech_stack", groupId: "workspace", description: "Detect framework, tooling, and dependency stack." },
  { name: "swarm_get_lock_stats", groupId: "workspace", description: "Return in-process file-lock statistics." },

  { name: "swarm_git_status", groupId: "git", description: "Return git status for a repository." },
  { name: "swarm_git_commit", groupId: "git", mutatesWorkspace: true, description: "Create a git commit." },
  { name: "swarm_git_create_branch", groupId: "git", mutatesWorkspace: true, description: "Create a git branch." },
  { name: "swarm_generate_mr_description", groupId: "git", description: "Generate a merge-request description." },

  { name: "swarm_run_lint", groupId: "ci", description: "Run lint command and parse results." },
  { name: "swarm_run_test", groupId: "ci", description: "Run test command and parse results." },
  { name: "swarm_autofix_lint", groupId: "ci", mutatesWorkspace: true, description: "Run lint autofix loop." },

  { name: "swarm_list_agents", groupId: "agents", description: "List available specialist agents." },
  { name: "swarm_recommend_agent", groupId: "agents", description: "Recommend an agent for a task." },
  { name: "swarm_create_dynamic_agents", groupId: "agents", requiresExternalApi: true, description: "Create dynamic agent roles for a task." },
  { name: "swarm_execute_swarm", groupId: "agents", requiresExternalApi: true, description: "Execute a generated agent swarm." },
  { name: "swarm_generate_agent_roles", groupId: "agents", requiresExternalApi: true, description: "Generate agent roles without executing them." },

  { name: "swarm_list_skills", groupId: "skills", description: "List built-in and loaded skills." },
  { name: "swarm_execute_skill", groupId: "skills", requiresExternalApi: true, description: "Execute a skill with task input." },

  { name: "swarm_list_gates", groupId: "governance", description: "List available quality gates." },
  { name: "swarm_validate_with_gates", groupId: "governance", description: "Validate content with selected quality gates." },

  { name: "swarm_db_stats", groupId: "data", description: "Return database connectivity and collection stats." },
  { name: "swarm_vector_search", groupId: "data", description: "Search vector store entries." },
  { name: "swarm_vector_upsert", groupId: "data", mutatesWorkspace: true, description: "Upsert vector store entries." },
  { name: "swarm_cache_stats", groupId: "data", description: "Return smart-cache stats." },
  { name: "swarm_code_stats", groupId: "data", description: "Return code-store stats." },
];

export function listAxiAgentMcpTools(groupId?: AxiAgentMcpToolGroupId): AxiAgentMcpToolContract[] {
  return groupId ? AXI_AGENT_MCP_TOOLS.filter((tool) => tool.groupId === groupId) : [...AXI_AGENT_MCP_TOOLS];
}

export function getAxiAgentMcpTool(name: string): AxiAgentMcpToolContract | undefined {
  return AXI_AGENT_MCP_TOOLS.find((tool) => tool.name === name);
}
