import axios from 'axios'

const appBase = import.meta.env.BASE_URL || '/'
const BFF_BASE_URL = `${appBase}${appBase.endsWith('/') ? '' : '/'}`

// BFF API 客户端 - 使用与原 API 相同的 axios 实例配置
const bffApi = axios.create({
  baseURL: BFF_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Dashboard BFF API
export const dashboardBffApi = {
  // 获取聚合的 Dashboard 统计数据
  // 这替代了之前的 4 个并行调用：
  // - agentsApi.list()
  // - tasksApi.list()
  // - toolsApi.list()
  // - systemApi.getStats()
  getStats: () => bffApi.get('/api/v1/dashboard/stats'),
}

// 保留原有 API 供其他页面使用（BFF 会逐步迁移更多端点）
export const agentsApi = {
  list: () => bffApi.get('/api/v1/agents'),
  get: (id: string) => bffApi.get(`/api/v1/agents/${id}`),
  create: (data: any) => bffApi.post('/api/v1/agents', data),
  update: (id: string, data: any) => bffApi.put(`/api/v1/agents/${id}`, data),
  delete: (id: string) => bffApi.delete(`/api/v1/agents/${id}`),
  start: (id: string) => bffApi.post(`/api/v1/agents/${id}/start`),
  stop: (id: string) => bffApi.post(`/api/v1/agents/${id}/stop`),
}

export const tasksApi = {
  list: (params?: { status?: string; parent_id?: string }) => bffApi.get('/api/v1/tasks', { params }),
  get: (id: string) => bffApi.get(`/api/v1/tasks/${id}`),
  create: (data: any) => bffApi.post('/api/v1/tasks', data),
}

export const toolsApi = {
  list: (params?: { category?: string; enabled_only?: boolean }) =>
    bffApi.get('/api/v1/tools', { params }),
  get: (id: string) => bffApi.get(`/api/v1/tools/${id}`),
}

export const systemApi = {
  getStats: () => bffApi.get('/api/v1/stats'),
  health: () => bffApi.get('/health'),
}

export default bffApi
