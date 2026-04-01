import { useState, useEffect } from 'react'
import { Plus, Play, Square, Pause, Edit2, Trash2, Bot, Settings, Cpu } from 'lucide-react'
import { useAgentsStore } from '../store'
import { agentsApi } from '../services/api'
import { Agent, AgentCreate, AVAILABLE_MODELS } from '../types'

export default function Agents() {
  const { agents, setAgents, removeAgent } = useAgentsStore()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null)
  const [formData, setFormData] = useState<AgentCreate>({
    name: '',
    description: '',
    system_prompt: '',
    model_name: 'abab6-chat',
    temperature: 0.7,
    max_tokens: 2048,
    tools: [],
    capabilities: [],
  })

  useEffect(() => {
    fetchAgents()
  }, [])

  const fetchAgents = async () => {
    try {
      const response = await agentsApi.list()
      setAgents(response.data)
    } catch (error) {
      console.error('Failed to fetch agents:', error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      if (editingAgent) {
        await agentsApi.update(editingAgent.id, formData)
      } else {
        await agentsApi.create(formData)
      }
      setIsModalOpen(false)
      setEditingAgent(null)
      setFormData({
        name: '',
        description: '',
        system_prompt: '',
        model_name: 'abab6-chat',
        temperature: 0.7,
        max_tokens: 2048,
        tools: [],
        capabilities: [],
      })
      fetchAgents()
    } catch (error) {
      console.error('Failed to save agent:', error)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个智能体吗？')) return
    try {
      await agentsApi.delete(id)
      removeAgent(id)
    } catch (error) {
      console.error('Failed to delete agent:', error)
    }
  }

  const handleStart = async (id: string) => {
    try {
      await agentsApi.start(id)
      fetchAgents()
    } catch (error) {
      console.error('Failed to start agent:', error)
    }
  }

  const handleStop = async (id: string) => {
    try {
      await agentsApi.stop(id)
      fetchAgents()
    } catch (error) {
      console.error('Failed to stop agent:', error)
    }
  }

  const openEditModal = (agent: Agent) => {
    setEditingAgent(agent)
    setFormData({
      name: agent.name,
      description: agent.description || '',
      system_prompt: agent.system_prompt,
      model_name: agent.model_name,
      temperature: agent.temperature,
      max_tokens: agent.max_tokens,
      tools: agent.tools,
      capabilities: agent.capabilities,
    })
    setIsModalOpen(true)
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'idle': return 'bg-emerald-400'
      case 'busy': return 'bg-amber-400'
      case 'error': return 'bg-red-400'
      default: return 'bg-slate-500'
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-100">智能体管理</h2>
          <p className="text-slate-400 mt-1">创建和管理您的AI智能体</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          创建智能体
        </button>
      </div>

      {/* Agents Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {agents.map((agent) => (
          <div key={agent.id} className="glass rounded-xl p-6 card-hover">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500 to-accent-purple flex items-center justify-center">
                  <Bot className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-100">{agent.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <div className={`w-2 h-2 rounded-full ${getStatusColor(agent.status)}`} />
                    <span className="text-xs text-slate-400 capitalize">{agent.status}</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-1">
                {agent.status === 'offline' ? (
                  <button
                    onClick={() => handleStart(agent.id)}
                    className="p-2 rounded-lg hover:bg-dark-700 text-emerald-400 transition-colors"
                    title="启动"
                  >
                    <Play className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => handleStop(agent.id)}
                    className="p-2 rounded-lg hover:bg-dark-700 text-red-400 transition-colors"
                    title="停止"
                  >
                    <Square className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => openEditModal(agent)}
                  className="p-2 rounded-lg hover:bg-dark-700 text-slate-400 hover:text-slate-200 transition-colors"
                  title="编辑"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(agent.id)}
                  className="p-2 rounded-lg hover:bg-dark-700 text-slate-400 hover:text-red-400 transition-colors"
                  title="删除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <p className="text-sm text-slate-400 mb-4 line-clamp-2">
              {agent.description || '暂无描述'}
            </p>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">模型</span>
                <span className="text-slate-300">{agent.model_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">温度</span>
                <span className="text-slate-300">{agent.temperature}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">任务数</span>
                <span className="text-slate-300">{agent.task_count}</span>
              </div>
            </div>

            {agent.capabilities.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {agent.capabilities.map((cap) => (
                  <span
                    key={cap}
                    className="px-2 py-1 bg-primary-500/10 text-primary-400 text-xs rounded-full"
                  >
                    {cap}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {agents.length === 0 && (
        <div className="text-center py-16">
          <Bot className="w-16 h-16 text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-400">暂无智能体</h3>
          <p className="text-slate-500 mt-2">点击上方按钮创建您的第一个智能体</p>
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass rounded-xl w-full max-w-2xl max-h-[90vh] overflow-auto">
            <div className="p-6 border-b border-slate-700/50">
              <h3 className="text-xl font-semibold text-slate-100">
                {editingAgent ? '编辑智能体' : '创建智能体'}
              </h3>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">名称</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="input-field"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">描述</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">系统提示词</label>
                <textarea
                  value={formData.system_prompt}
                  onChange={(e) => setFormData({ ...formData, system_prompt: e.target.value })}
                  className="input-field h-32 resize-none"
                  required
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-3">
                  <label className="block text-sm font-medium text-slate-300 mb-2">模型选择</label>
                  <div className="grid grid-cols-2 gap-3">
                    {AVAILABLE_MODELS.map((model) => (
                      <div
                        key={model.id}
                        onClick={() => setFormData({ ...formData, model_name: model.id })}
                        className={`
                          p-4 rounded-lg border-2 cursor-pointer transition-all
                          ${formData.model_name === model.id
                            ? 'border-primary-500 bg-primary-500/10'
                            : 'border-slate-600 bg-dark-700 hover:border-slate-500'}
                        `}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Cpu className={`w-4 h-4 ${model.provider === 'minimax' ? 'text-purple-400' : 'text-green-400'}`} />
                              <span className="font-semibold text-slate-100">{model.name}</span>
                            </div>
                            <p className="text-xs text-slate-400">{model.description}</p>
                          </div>
                          {formData.model_name === model.id && (
                            <div className="w-5 h-5 rounded-full bg-primary-500 flex items-center justify-center">
                              <span className="text-white text-xs">✓</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">温度</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={formData.temperature}
                    onChange={(e) => setFormData({ ...formData, temperature: parseFloat(e.target.value) })}
                    className="input-field"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">最大令牌</label>
                  <input
                    type="number"
                    value={formData.max_tokens}
                    onChange={(e) => setFormData({ ...formData, max_tokens: parseInt(e.target.value) })}
                    className="input-field"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  能力标签 (用逗号分隔)
                </label>
                <input
                  type="text"
                  value={formData.capabilities?.join(', ')}
                  onChange={(e) => setFormData({ 
                    ...formData, 
                    capabilities: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                  })}
                  className="input-field"
                  placeholder="code, writing, analysis..."
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false)
                    setEditingAgent(null)
                  }}
                  className="btn-secondary"
                >
                  取消
                </button>
                <button type="submit" className="btn-primary">
                  {editingAgent ? '保存' : '创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
