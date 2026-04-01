import { create } from 'zustand'
import { Agent, Task, Tool, Session, SystemStats } from '../types'

// Agents Store
interface AgentsState {
  agents: Agent[]
  selectedAgent: Agent | null
  isLoading: boolean
  error: string | null
  setAgents: (agents: Agent[]) => void
  setSelectedAgent: (agent: Agent | null) => void
  addAgent: (agent: Agent) => void
  updateAgent: (agent: Agent) => void
  removeAgent: (id: string) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useAgentsStore = create<AgentsState>((set) => ({
  agents: [],
  selectedAgent: null,
  isLoading: false,
  error: null,
  setAgents: (agents) => set({ agents }),
  setSelectedAgent: (agent) => set({ selectedAgent: agent }),
  addAgent: (agent) => set((state) => ({ agents: [...state.agents, agent] })),
  updateAgent: (agent) => set((state) => ({
    agents: state.agents.map((a) => (a.id === agent.id ? agent : a)),
  })),
  removeAgent: (id) => set((state) => ({
    agents: state.agents.filter((a) => a.id !== id),
  })),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
}))

// Tasks Store
interface TasksState {
  tasks: Task[]
  selectedTask: Task | null
  isLoading: boolean
  error: string | null
  setTasks: (tasks: Task[]) => void
  setSelectedTask: (task: Task | null) => void
  addTask: (task: Task) => void
  updateTask: (task: Task) => void
  removeTask: (id: string) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useTasksStore = create<TasksState>((set) => ({
  tasks: [],
  selectedTask: null,
  isLoading: false,
  error: null,
  setTasks: (tasks) => set({ tasks }),
  setSelectedTask: (task) => set({ selectedTask: task }),
  addTask: (task) => set((state) => ({ tasks: [task, ...state.tasks] })),
  updateTask: (task) => set((state) => ({
    tasks: state.tasks.map((t) => (t.id === task.id ? task : t)),
  })),
  removeTask: (id) => set((state) => ({
    tasks: state.tasks.filter((t) => t.id !== id),
  })),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
}))

// Tools Store
interface ToolsState {
  tools: Tool[]
  selectedTool: Tool | null
  isLoading: boolean
  error: string | null
  setTools: (tools: Tool[]) => void
  setSelectedTool: (tool: Tool | null) => void
  addTool: (tool: Tool) => void
  updateTool: (tool: Tool) => void
  removeTool: (id: string) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useToolsStore = create<ToolsState>((set) => ({
  tools: [],
  selectedTool: null,
  isLoading: false,
  error: null,
  setTools: (tools) => set({ tools }),
  setSelectedTool: (tool) => set({ selectedTool: tool }),
  addTool: (tool) => set((state) => ({ tools: [...state.tools, tool] })),
  updateTool: (tool) => set((state) => ({
    tools: state.tools.map((t) => (t.id === tool.id ? tool : t)),
  })),
  removeTool: (id) => set((state) => ({
    tools: state.tools.filter((t) => t.id !== id),
  })),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
}))

// Memory Store
interface MemoryState {
  sessions: Session[]
  selectedSession: Session | null
  isLoading: boolean
  error: string | null
  setSessions: (sessions: Session[]) => void
  setSelectedSession: (session: Session | null) => void
  addSession: (session: Session) => void
  removeSession: (id: string) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useMemoryStore = create<MemoryState>((set) => ({
  sessions: [],
  selectedSession: null,
  isLoading: false,
  error: null,
  setSessions: (sessions) => set({ sessions }),
  setSelectedSession: (session) => set({ selectedSession: session }),
  addSession: (session) => set((state) => ({ sessions: [...state.sessions, session] })),
  removeSession: (id) => set((state) => ({
    sessions: state.sessions.filter((s) => s.session_id !== id),
  })),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
}))

// System Store
interface SystemState {
  stats: SystemStats | null
  isLoading: boolean
  error: string | null
  setStats: (stats: SystemStats) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useSystemStore = create<SystemState>((set) => ({
  stats: null,
  isLoading: false,
  error: null,
  setStats: (stats) => set({ stats }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
}))

// UI Store
interface UIState {
  sidebarOpen: boolean
  rightSidebarOpen: boolean
  currentPage: string
  theme: 'dark' | 'light'
  setSidebarOpen: (open: boolean) => void
  setRightSidebarOpen: (open: boolean) => void
  setCurrentPage: (page: string) => void
  setTheme: (theme: 'dark' | 'light') => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  rightSidebarOpen: true,
  currentPage: 'dashboard',
  theme: 'dark',
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setRightSidebarOpen: (open) => set({ rightSidebarOpen: open }),
  setCurrentPage: (page) => set({ currentPage: page }),
  setTheme: (theme) => set({ theme }),
}))
