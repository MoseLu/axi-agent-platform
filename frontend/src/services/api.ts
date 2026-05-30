import axios from 'axios'

const appBase = import.meta.env.BASE_URL || '/'
const API_BASE_URL = `${appBase}${appBase.endsWith('/') ? '' : '/'}api/v1`

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Agents API
export const agentsApi = {
  list: () => api.get('/agents'),
  get: (id: string) => api.get(`/agents/${id}`),
  create: (data: any) => api.post('/agents', data),
  update: (id: string, data: any) => api.put(`/agents/${id}`, data),
  delete: (id: string) => api.delete(`/agents/${id}`),
  start: (id: string) => api.post(`/agents/${id}/start`),
  stop: (id: string) => api.post(`/agents/${id}/stop`),
  pause: (id: string) => api.post(`/agents/${id}/pause`),
  resume: (id: string) => api.post(`/agents/${id}/resume`),
  getStats: (id: string) => api.get(`/agents/${id}/stats`),
  execute: (id: string, taskInput: string, context?: any) => 
    api.post(`/agents/${id}/execute`, null, { params: { task_input: taskInput, context } }),
  findByCapability: (capability: string) => api.get(`/agents/by-capability/${capability}`),
}

// Tasks API
export const tasksApi = {
  list: (params?: { status?: string; parent_id?: string }) => api.get('/tasks', { params }),
  get: (id: string) => api.get(`/tasks/${id}`),
  create: (data: any) => api.post('/tasks', data),
  update: (id: string, data: any) => api.put(`/tasks/${id}`, data),
  delete: (id: string) => api.delete(`/tasks/${id}`),
  cancel: (id: string) => api.post(`/tasks/${id}/cancel`),
  pause: (id: string) => api.post(`/tasks/${id}/pause`),
  resume: (id: string) => api.post(`/tasks/${id}/resume`),
  getStats: () => api.get('/tasks/stats/overview'),
}

// Tools API
export const toolsApi = {
  list: (params?: { category?: string; tool_type?: string; enabled_only?: boolean }) => 
    api.get('/tools', { params }),
  get: (id: string) => api.get(`/tools/${id}`),
  create: (data: any) => api.post('/tools', data),
  update: (id: string, data: any) => api.put(`/tools/${id}`, data),
  delete: (id: string) => api.delete(`/tools/${id}`),
  execute: (id: string, parameters: any, agentId?: string, taskId?: string) => 
    api.post(`/tools/${id}/execute`, parameters, { params: { agent_id: agentId, task_id: taskId } }),
  enable: (id: string) => api.post(`/tools/${id}/enable`),
  disable: (id: string) => api.post(`/tools/${id}/disable`),
  getCategories: () => api.get('/tools/categories/list'),
}

// Memory API
export const memoryApi = {
  // Sessions
  createSession: (title?: string) => api.post('/memory/sessions', null, { params: { title } }),
  listSessions: () => api.get('/memory/sessions'),
  getSession: (id: string) => api.get(`/memory/sessions/${id}`),
  deleteSession: (id: string) => api.delete(`/memory/sessions/${id}`),
  addMessage: (sessionId: string, role: string, content: string, metadata?: any) => 
    api.post(`/memory/sessions/${sessionId}/messages`, null, { params: { role, content, metadata } }),
  getMessages: (sessionId: string, limit?: number) => 
    api.get(`/memory/sessions/${sessionId}/messages`, { params: { limit } }),
  clearSession: (id: string) => api.delete(`/memory/sessions/${id}/messages`),
  updateContext: (sessionId: string, key: string, value: any) => 
    api.put(`/memory/sessions/${sessionId}/context`, null, { params: { key, value } }),
  getContext: (sessionId: string) => api.get(`/memory/sessions/${sessionId}/context`),
  
  // Long-term memory
  addLongTerm: (content: string, metadata?: any) => 
    api.post('/memory/long-term', null, { params: { content, metadata } }),
  searchLongTerm: (query: string, topK?: number) => 
    api.get('/memory/long-term/search', { params: { query, top_k: topK } }),
  getLongTerm: (id: string) => api.get(`/memory/long-term/${id}`),
  deleteLongTerm: (id: string) => api.delete(`/memory/long-term/${id}`),
  updateLongTerm: (id: string, content?: string, metadata?: any) => 
    api.put(`/memory/long-term/${id}`, null, { params: { content, metadata } }),
  saveSession: (sessionId: string, summary?: string) => 
    api.post(`/memory/sessions/${sessionId}/save`, null, { params: { summary } }),
  
  // Stats
  getStats: () => api.get('/memory/stats'),
}

// System API
export const systemApi = {
  getStats: () => api.get('/stats'),
  health: () => api.get('/health'),
}

// SubAgent API
export const subagentApi = {
  // Worktree management
  getWorktreeStats: () => api.get('/subagent/worktree/stats'),
  createWorktree: (data: { agent_id: string; branch_name?: string; base_branch?: string }) =>
    api.post('/subagent/worktree/create', data),
  getWorktree: (agentId: string) => api.get(`/subagent/worktree/${agentId}`),
  syncWorktree: (data: { agent_id: string; fetch?: boolean }) =>
    api.post('/subagent/worktree/sync', data),
  getWorktreeChanges: (agentId: string) => api.get(`/subagent/worktree/${agentId}/changes`),
  commitWorktree: (data: { agent_id: string; message: string }) =>
    api.post('/subagent/worktree/commit', data),
  mergeWorktree: (data: { agent_id: string; target_branch?: string }) =>
    api.post('/subagent/worktree/merge', data),
  removeWorktree: (agentId: string, force?: boolean) =>
    api.delete(`/subagent/worktree/${agentId}`, { params: { force } }),
  cleanupWorktrees: (olderThanHours: number = 24) =>
    api.post('/subagent/worktree/cleanup', null, { params: { older_than_hours: olderThanHours } }),
  // Quality assessment
  assessCodeQuality: (data: any) => api.post('/subagent/quality/assess', data),
  // Config
  getConfig: () => api.get('/subagent/config'),
}

export default api
