import { useState, useEffect } from 'react'
import { Plus, Play, Edit2, Trash2, Wrench, CheckCircle, XCircle } from 'lucide-react'
import { useToolsStore } from '../store'
import { toolsApi } from '../services/api'
import { Tool } from '../types'

export default function Tools() {
  const { tools, setTools, removeTool } = useToolsStore()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingTool, setEditingTool] = useState<Tool | null>(null)
  const [testResult, setTestResult] = useState<any>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'other',
    parameters: '{}',
  })

  useEffect(() => {
    fetchTools()
  }, [])

  const fetchTools = async () => {
    try {
      const response = await toolsApi.list({ enabled_only: false })
      setTools(response.data)
    } catch (error) {
      console.error('Failed to fetch tools:', error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const data = {
        ...formData,
        parameters: JSON.parse(formData.parameters),
      }
      
      if (editingTool) {
        await toolsApi.update(editingTool.id, data)
      } else {
        await toolsApi.create(data)
      }
      setIsModalOpen(false)
      setEditingTool(null)
      setFormData({ name: '', description: '', category: 'other', parameters: '{}' })
      fetchTools()
    } catch (error) {
      console.error('Failed to save tool:', error)
      alert('保存失败，请检查参数格式')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个工具吗？')) return
    try {
      await toolsApi.delete(id)
      removeTool(id)
    } catch (error) {
      console.error('Failed to delete tool:', error)
    }
  }

  const handleToggle = async (tool: Tool) => {
    try {
      if (tool.enabled) {
        await toolsApi.disable(tool.id)
      } else {
        await toolsApi.enable(tool.id)
      }
      fetchTools()
    } catch (error) {
      console.error('Failed to toggle tool:', error)
    }
  }

  const handleTest = async (tool: Tool) => {
    try {
      const testParams = {}
      const result = await toolsApi.execute(tool.id, testParams)
      setTestResult(result.data)
    } catch (error) {
      console.error('Failed to test tool:', error)
      setTestResult({ success: false, error: '测试失败' })
    }
  }

  const openEditModal = (tool: Tool) => {
    setEditingTool(tool)
    setFormData({
      name: tool.name,
      description: tool.description,
      category: tool.category,
      parameters: JSON.stringify(tool.parameters, null, 2),
    })
    setIsModalOpen(true)
  }

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      search: 'bg-blue-500/10 text-blue-400',
      file: 'bg-emerald-500/10 text-emerald-400',
      calculate: 'bg-amber-500/10 text-amber-400',
      code: 'bg-purple-500/10 text-purple-400',
      data: 'bg-pink-500/10 text-pink-400',
      web: 'bg-cyan-500/10 text-cyan-400',
      system: 'bg-red-500/10 text-red-400',
    }
    return colors[category] || 'bg-slate-500/10 text-slate-400'
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-100">工具管理</h2>
          <p className="text-slate-400 mt-1">管理内置工具和自定义工具</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          添加工具
        </button>
      </div>

      {/* Tools Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {tools.map((tool) => (
          <div key={tool.id} className="glass rounded-xl p-6 card-hover">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${getCategoryColor(tool.category)}`}>
                  <Wrench className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-100">{tool.name}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${getCategoryColor(tool.category)}`}>
                    {tool.category}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {tool.enabled ? (
                  <CheckCircle className="w-5 h-5 text-emerald-400" />
                ) : (
                  <XCircle className="w-5 h-5 text-slate-500" />
                )}
              </div>
            </div>

            <p className="text-sm text-slate-400 mb-4 line-clamp-2">
              {tool.description}
            </p>

            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">类型: {tool.tool_type}</span>
              <span className="text-slate-500">使用: {tool.use_count}次</span>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => handleToggle(tool)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tool.enabled 
                    ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' 
                    : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                }`}
              >
                {tool.enabled ? '禁用' : '启用'}
              </button>
              <button
                onClick={() => handleTest(tool)}
                className="flex-1 py-2 rounded-lg bg-primary-500/10 text-primary-400 hover:bg-primary-500/20 text-sm font-medium transition-colors"
              >
                测试
              </button>
              {tool.tool_type === 'custom' && (
                <>
                  <button
                    onClick={() => openEditModal(tool)}
                    className="p-2 rounded-lg hover:bg-dark-700 text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(tool.id)}
                    className="p-2 rounded-lg hover:bg-dark-700 text-slate-400 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {tools.length === 0 && (
        <div className="text-center py-16">
          <Wrench className="w-16 h-16 text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-400">暂无工具</h3>
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass rounded-xl w-full max-w-lg max-h-[90vh] overflow-auto">
            <div className="p-6 border-b border-slate-700/50">
              <h3 className="text-xl font-semibold text-slate-100">
                {editingTool ? '编辑工具' : '添加工具'}
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
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">类别</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="input-field"
                >
                  <option value="search">搜索</option>
                  <option value="file">文件</option>
                  <option value="calculate">计算</option>
                  <option value="code">代码</option>
                  <option value="data">数据</option>
                  <option value="web">网络</option>
                  <option value="other">其他</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  参数 (JSON格式)
                </label>
                <textarea
                  value={formData.parameters}
                  onChange={(e) => setFormData({ ...formData, parameters: e.target.value })}
                  className="input-field h-32 font-mono text-sm resize-none"
                  placeholder='{"type": "object", "properties": {}}'
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false)
                    setEditingTool(null)
                  }}
                  className="btn-secondary"
                >
                  取消
                </button>
                <button type="submit" className="btn-primary">
                  {editingTool ? '保存' : '添加'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Test Result Modal */}
      {testResult && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass rounded-xl w-full max-w-lg">
            <div className="p-6 border-b border-slate-700/50">
              <h3 className="text-xl font-semibold text-slate-100">测试结果</h3>
            </div>
            <div className="p-6">
              <div className={`p-4 rounded-lg ${testResult.success ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                <p className={`font-medium ${testResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                  {testResult.success ? '执行成功' : '执行失败'}
                </p>
                {testResult.result && (
                  <pre className="mt-2 text-sm text-slate-300 overflow-auto max-h-48">
                    {JSON.stringify(testResult.result, null, 2)}
                  </pre>
                )}
                {testResult.error && (
                  <p className="mt-2 text-sm text-red-400">{testResult.error}</p>
                )}
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => setTestResult(null)}
                  className="btn-secondary"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
