// Agent types
export type AgentRole =
  | 'general'        // 通用智能体
  | 'planner'        // subAgent: 规划者
  | 'worker'         // subAgent: 工作者
  | 'code_worker'    // subAgent: 代码工作者
  | 'code_reviewer'  // subAgent: 代码审查者
  | 'test_engineer'  // subAgent: 测试工程师
  | 'doc_generator'  // subAgent: 文档生成者
  | 'judge'          // subAgent: 裁判

export type ModelProvider = 'minimax' | 'openai'

export interface ModelConfig {
  id: string
  name: string
  provider: ModelProvider
  maxTokens: number
  description: string
}

// 可用模型配置
export const AVAILABLE_MODELS: ModelConfig[] = [
  {
    id: 'abab6-chat',
    name: 'MiniMax ABAB6 (32K)',
    provider: 'minimax',
    maxTokens: 8192,
    description: 'MiniMax 最新的对话模型，支持32K上下文'
  },
  {
    id: 'abab6.5-chat',
    name: 'MiniMax ABAB6.5 (128K)',
    provider: 'minimax',
    maxTokens: 8192,
    description: 'MiniMax 长文本模型，支持128K上下文'
  },
  {
    id: 'abab5.5-chat',
    name: 'MiniMax ABAB5.5 (245K)',
    provider: 'minimax',
    maxTokens: 8192,
    description: 'MiniMax 超长文本模型，支持245K上下文'
  },
  {
    id: 'gpt-4',
    name: 'GPT-4',
    provider: 'openai',
    maxTokens: 8192,
    description: 'OpenAI GPT-4，强大的推理能力'
  },
  {
    id: 'gpt-4-turbo',
    name: 'GPT-4 Turbo',
    provider: 'openai',
    maxTokens: 128000,
    description: 'OpenAI GPT-4 Turbo，快速且强大的模型'
  },
  {
    id: 'gpt-3.5-turbo',
    name: 'GPT-3.5 Turbo',
    provider: 'openai',
    maxTokens: 16385,
    description: 'OpenAI GPT-3.5 Turbo，快速且经济'
  },
]

export interface Agent {
  id: string
  name: string
  description?: string
  system_prompt: string
  model_name: string
  temperature: number
  max_tokens: number
  tools: string[]
  capabilities: string[]
  role: AgentRole
  metadata: Record<string, any>
  status: 'idle' | 'busy' | 'paused' | 'error' | 'offline'
  created_at: string
  updated_at: string
  last_active?: string
  task_count: number
  success_count: number
}

export interface AgentCreate {
  name: string
  description?: string
  system_prompt: string
  model_name?: string
  temperature?: number
  max_tokens?: number
  tools?: string[]
  capabilities?: string[]
  role?: AgentRole
  metadata?: Record<string, any>
}

// Task types
export type TaskType =
  | 'general'           // 通用任务
  | 'code_development'   // 代码开发任务
  | 'code_review'       // 代码审查任务
  | 'test_writing'      // 测试编写任务
  | 'doc_generation'    // 文档生成任务

export interface SubTask {
  id: string
  name: string
  description: string
  agent_id?: string
  agent_role?: string
  status: 'pending' | 'planning' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'reviewing' | 'merging'
  dependencies: string[]
  task_type: TaskType
  input_data: Record<string, any>
  output_data?: Record<string, any>
  started_at?: string
  completed_at?: string
  error_message?: string
  worktree_path?: string
}

export interface Task {
  id: string
  title: string
  description?: string
  priority: number
  task_type: TaskType
  status: 'pending' | 'planning' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'reviewing' | 'merging'
  parent_id?: string
  use_subagent_mode: boolean
  repository_path?: string
  subtasks: SubTask[]
  current_agent_id?: string
  input_data: Record<string, any>
  output_data: Record<string, any>
  progress: number
  tags: string[]
  created_at: string
  updated_at: string
  started_at?: string
  completed_at?: string
  error_message?: string
}

export interface TaskCreate {
  title: string
  description?: string
  priority?: number
  task_type?: TaskType
  use_subagent_mode?: boolean
  repository_path?: string
  input_data?: Record<string, any>
  tags?: string[]
}

// SubAgent Worktree types
export interface WorktreeInfo {
  agent_id: string
  branch: string
  path: string
  created_at: string
}

export interface CodeChanges {
  added: string[]
  modified: string[]
  deleted: string[]
}

export interface WorktreeStats {
  total_worktrees: number
  max_worktrees: number
  available_worktrees: number
  base_repo_path: string
  worktrees: WorktreeInfo[]
}

// Tool types
export interface Tool {
  id: string
  name: string
  description: string
  category: string
  tool_type: 'builtin' | 'custom'
  parameters: Record<string, any>
  required_permissions: string[]
  enabled: boolean
  use_count: number
  created_at: string
  updated_at: string
}

// Memory types
export interface Session {
  session_id: string
  message_count: number
  context: Record<string, any>
  created_at: string
  updated_at: string
}

export interface Message {
  id: string
  role: 'system' | 'user' | 'assistant'
  content: string
  metadata?: Record<string, any>
  timestamp: string
}

export interface Memory {
  id: string
  content: string
  metadata: Record<string, any>
  distance?: number
}

// System stats
export interface SystemStats {
  tasks: {
    total: number
    by_status: Record<string, number>
    by_type: Record<string, number>
    running: number
    queue_size: number
    max_parallel_agents: number
  }
  memory: {
    session_count: number
    total_session_messages: number
    long_term_memory?: {
      total_memories: number
      collection_name: string
    }
  }
  agents: {
    total: number
    running: number
  }
  tools: {
    total: number
    enabled: number
  }
  code_isolation?: WorktreeStats
  timestamp: string
}

// SubAgent config
export interface SubAgentConfig {
  max_parallel_agents: number
  supported_roles: string[]
  task_types: string[]
  max_worktrees: number
  default_base_branch: string
}

// Code Quality Assessment
export interface CodeQualityAssessment {
  code_score: number
  completeness_score: number
  test_score: number
  documentation_score: number
  comments: string[]
  approved: boolean
}
