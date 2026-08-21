import { useState, useEffect } from 'react'
import { Plus, Play, Pause, Square, Trash2, Clock, CheckCircle, XCircle, Zap, Users, GitBranch } from 'lucide-react'
import { useTasksStore } from '../store'
import { tasksApi } from '../services/api'
import { Task, TaskCreate, TaskType } from '../types'

// 协作模式配置
const COLLABORATION_MODES = {
  general: {
    id: 'general',
    name: '通用协作模式',
    icon: Users,
    description: '适用于大多数任务的通用协作方式，智能体自主交接和并行工作',
    taskType: 'general' as TaskType,
    useSubagent: false
  },
  subagent: {
    id: 'subagent',
    name: 'SubAgent 代码开发模式',
    icon: GitBranch,
    description: '专为代码开发优化的协作模式，包含规划者、工作者、裁判三层架构',
    taskType: 'code_development' as TaskType,
    useSubagent: true
  },
  cluster: {
    id: 'cluster',
    name: 'Cluster 并行集群模式',
    icon: Users,
    description: '适用于海量解耦任务的并行执行，最大化提升效率',
    taskType: 'cluster' as TaskType,
    useSubagent: true
  },
  hybrid: {
    id: 'hybrid',
    name: 'Hybrid 混合组合模式',
    icon: Zap,
    description: '适用于复杂全栈项目，支持多层级功能组协作',
    taskType: 'hybrid' as TaskType,
    useSubagent: true
  }
}

export default function Tasks() {
  const { tasks, setTasks, removeTask } = useTasksStore()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedMode, setSelectedMode] = useState<'general' | 'subagent' | 'cluster' | 'hybrid'>('general')
  const [useAutoStrategy, setUseAutoStrategy] = useState(true)
  const [formData, setFormData] = useState<any>({
    title: '',
    description: '',
    priority: 2,
    task_type: 'general',
    use_subagent_mode: false,
    strategy_mode: 'auto',
    input_data: {},
    tags: [],
  })

  useEffect(() => {
    fetchTasks()
  }, [])

  const fetchTasks = async () => {
    try {
      const response = await tasksApi.list()
      setTasks(response.data)
    } catch (error) {
      console.error('Failed to fetch tasks:', error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      // 根据选择的模式自动设置参数
      const modeConfig = COLLABORATION_MODES[selectedMode]
      const taskData: any = {
        ...formData,
        task_type: useAutoStrategy ? 'general' : modeConfig.taskType,
        use_subagent_mode: useAutoStrategy ? false : modeConfig.useSubagent,
        strategy_mode: useAutoStrategy ? 'auto' : 'manual'
      }

      await tasksApi.create(taskData)
      setIsModalOpen(false)
      setFormData({
        title: '',
        description: '',
        priority: 2,
        task_type: modeConfig.taskType,
        use_subagent_mode: modeConfig.useSubagent,
        input_data: {},
        tags: [],
      })
      fetchTasks()
    } catch (error) {
      console.error('Failed to create task:', error)
    }
  }

  const handleModeChange = (mode: 'general' | 'subagent') => {
    setSelectedMode(mode)
    const modeConfig = COLLABORATION_MODES[mode]
    setFormData({
      ...formData,
      task_type: modeConfig.taskType,
      use_subagent_mode: modeConfig.useSubagent
    })
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个任务吗？')) return
    try {
      await tasksApi.delete(id)
      removeTask(id)
    } catch (error) {
      console.error('Failed to delete task:', error)
    }
  }

  const handleCancel = async (id: string) => {
    try {
      await tasksApi.cancel(id)
      fetchTasks()
    } catch (error) {
      console.error('Failed to cancel task:', error)
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="w-5 h-5 text-emerald-400" />
      case 'running': return <Clock className="w-5 h-5 text-amber-400" />
      case 'failed': return <XCircle className="w-5 h-5 text-red-400" />
      default: return <div className="w-5 h-5 rounded-full bg-slate-500" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
      case 'running': return 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      case 'failed': return 'bg-red-500/10 text-red-400 border-red-500/20'
      case 'pending': return 'bg-slate-500/10 text-slate-400 border-slate-500/20'
      default: return 'bg-slate-500/10 text-slate-400 border-slate-500/20'
    }
  }

  const getPriorityColor = (priority: number) => {
    switch (priority) {
      case 4: return 'text-red-400'
      case 3: return 'text-amber-400'
      case 2: return 'text-blue-400'
      default: return 'text-slate-400'
    }
  }

  const getPriorityLabel = (priority: number) => {
    switch (priority) {
      case 4: return '紧急'
      case 3: return '高'
      case 2: return '普通'
      default: return '低'
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-100">任务管理</h2>
          <p className="text-slate-400 mt-1">创建和管理您的AI任务</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          创建任务
        </button>
      </div>

      {/* Collaboration Mode Info */}
      <div className="glass rounded-xl p-6 bg-gradient-to-r from-purple-900/20 to-blue-900/20 border border-purple-500/30">
        <div className="flex items-start gap-3">
          <Zap className="w-6 h-6 text-purple-400 flex-shrink-0 mt-1" />
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-purple-300 mb-2">智能协作模式</h3>
            <p className="text-sm text-slate-300 leading-relaxed">
              系统会根据任务复杂度自动选择最优的协作方案：
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {Object.values(COLLABORATION_MODES).map((mode) => {
                const Icon = mode.icon
                const isSelected = selectedMode === mode.id
                return (
                  <div
                    key={mode.id}
                    onClick={() => handleModeChange(mode.id as 'general' | 'subagent')}
                    className={`
                      p-4 rounded-lg border-2 cursor-pointer transition-all
                      ${isSelected
                        ? 'border-purple-500 bg-purple-500/20'
                        : 'border-slate-600 bg-dark-700 hover:border-slate-500'}
                    }
                  `}
                  >
                    <Icon className={`w-5 h-5 ${isSelected ? 'text-purple-400' : 'text-slate-400'}`} />
                    <div className="mt-2">
                      <h4 className={`font-semibold ${isSelected ? 'text-purple-200' : 'text-slate-200'}`}>
                        {mode.name}
                      </h4>
                      <p className="text-xs text-slate-400 mt-1">{mode.description}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Tasks List */}
      <div className="glass rounded-xl overflow-hidden">
        <div className="p-6 border-b border-slate-700/50">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-100">任务列表</h3>
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-400">共 {tasks.length} 个任务</span>
            </div>
          </div>
        </div>

        {tasks.length > 0 ? (
          <table className="w-full">
            <thead>
              <tr className="bg-dark-800/50 text-left text-xs text-slate-400 uppercase">
                <th className="px-6 py-3 font-medium">标题</th>
                <th className="px-6 py-3 font-medium">状态</th>
                <th className="px-6 py-3 font-medium">优先级</th>
                <th className="px-6 py-3 font-medium">类型</th>
                <th className="px-6 py-3 font-medium">创建时间</th>
                <th className="px-6 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id} className="border-t border-slate-700/30 hover:bg-slate-700/20 transition-colors">
                  <td className="px-6 py-4">
                    <div>
                      <h4 className="font-semibold text-slate-100">{task.title}</h4>
                      <p className="text-sm text-slate-400 mt-1 line-clamp-1">
                        {task.description || '暂无描述'}
                      </p>
                      <div className="mt-2">
                        <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${getPriorityColor(task.priority)}`}>
                          {getPriorityLabel(task.priority)}
                        </span>
                        {task.tags && task.tags.length > 0 && (
                          task.tags.map((tag, idx) => (
                            <span key={idx} className="ml-2 inline-block px-2 py-1 bg-slate-600 text-slate-300 text-xs rounded">
                              {tag}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm ${getStatusColor(task.status)}`}>
                      {getStatusIcon(task.status)}
                      <span className="capitalize">{task.status}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`font-medium ${getPriorityColor(task.priority)}`}>
                      {getPriorityLabel(task.priority)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span className={task.use_subagent_mode ? 'text-purple-400' : 'text-slate-300'}>
                      {task.use_subagent_mode ? 'SubAgent' : '通用'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-400">
                    {new Date(task.created_at).toLocaleString()}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-2">
                      {task.status === 'running' && (
                        <button
                          onClick={() => handleCancel(task.id)}
                          className="p-2 rounded-lg hover:bg-dark-700 text-amber-400 transition-colors"
                          title="取消"
                        >
                          <Square className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(task.id)}
                        className="p-2 rounded-lg hover:bg-dark-700 text-slate-400 hover:text-red-400 transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-center py-16">
            <Clock className="w-16 h-16 text-slate-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-400">暂无任务</h3>
            <p className="text-slate-500 mt-2">点击上方按钮创建您的第一个任务</p>
          </div>
        )}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass rounded-xl w-full max-w-lg">
            <div className="p-6 border-b border-slate-700/50">
              <h3 className="text-xl font-semibold text-slate-100">创建任务</h3>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label htmlFor="task-title" className="block text-sm font-medium text-slate-300 mb-2">标题</label>
                <input
                  id="task-title"
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="input-field"
                  required
                />
              </div>

              <div>
                <label htmlFor="task-description" className="block text-sm font-medium text-slate-300 mb-2">描述</label>
                <textarea
                  id="task-description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="input-field h-24 resize-none"
                />
              </div>

              <div>
                <label htmlFor="task-priority" className="block text-sm font-medium text-slate-300 mb-2">优先级</label>
                <select
                  id="task-priority"
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) })}
                  className="input-field"
                >
                  <option value={1}>低</option>
                  <option value={2}>普通</option>
                  <option value={3}>高</option>
                  <option value={4}>紧急</option>
                </select>
              </div>

              <div className="flex items-center gap-2 mb-4 p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                <input
                  type="checkbox"
                  id="auto_strategy"
                  checked={useAutoStrategy}
                  onChange={(e) => setUseAutoStrategy(e.target.checked)}
                  className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                />
                <label htmlFor="auto_strategy" className="text-sm font-medium text-purple-200 cursor-pointer">
                  自动协作方案 (由系统根据任务描述自动评估)
                </label>
              </div>

              {!useAutoStrategy && (
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    手动选择协作模式：{COLLABORATION_MODES[selectedMode].name}
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                    {Object.values(COLLABORATION_MODES).map((mode) => {
                      const Icon = mode.icon
                      const isSelected = selectedMode === mode.id
                      return (
                        <div
                          key={mode.id}
                          onClick={() => setSelectedMode(mode.id as any)}
                          className={`
                            p-4 rounded-lg border-2 cursor-pointer transition-all
                            ${isSelected
                              ? 'border-purple-500 bg-purple-500/20'
                              : 'border-slate-600 bg-dark-700 hover:border-slate-500'}
                          }
                        `}
                        >
                          <Icon className={`w-5 h-5 ${isSelected ? 'text-purple-400' : 'text-slate-400'}`} />
                          <div className="mt-2">
                            <h4 className={`font-semibold text-sm ${isSelected ? 'text-purple-200' : 'text-slate-200'}`}>
                              {mode.name}
                            </h4>
                            <p className="text-xs text-slate-400">{mode.description}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="task-tags" className="block text-sm font-medium text-slate-300 mb-2">
                  标签 (用逗号分隔)
                </label>
                <input
                  id="task-tags"
                  type="text"
                  value={formData.tags?.join(', ')}
                  onChange={(e) => setFormData({
                    ...formData,
                    tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                  })}
                  className="input-field"
                  placeholder="tag1, tag2, tag3..."
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="btn-secondary"
                >
                  取消
                </button>
                <button type="submit" className="btn-primary">
                  创建
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
