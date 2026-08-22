import { useEffect, useState } from 'react'
import {
  Bot,
  ListTodo,
  Wrench,
  Brain,
  TrendingUp,
  Activity,
  Clock
} from 'lucide-react'
import { dashboardBffApi } from '../services/bff'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'

const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#06b6d4', '#10b981', '#f59e0b']

// BFF DTO 类型定义
interface AgentSummary {
  id: string
  name: string
  status: string
  created_at: string
}

interface TaskSummary {
  id: string
  title: string
  status: string
  created_at: string
}

interface DashboardStatsResponse {
  requestId: string
  agents: {
    total: number
    idle: number
    busy: number
    paused: number
    stopped: number
    list?: AgentSummary[]
  }
  tasks: {
    total: number
    by_status: Record<string, number>
    recent_list?: TaskSummary[]
  }
  tools: {
    total: number
    enabled: number
  }
  memory: {
    session_count: number
    total_session_messages: number
    long_term_count: number
  }
  timestamp: string
}

export default function Dashboard() {
  // BFF 返回的聚合数据
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [stats, setStats] = useState<DashboardStatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        setError(null)

        // BFF 聚合调用：一次请求替代之前的 4 个并行请求
        const res = await dashboardBffApi.getStats()
        const data: DashboardStatsResponse = res.data

        setStats(data)
        setAgents(data.agents.list || [])
        setTasks(data.tasks.recent_list || [])
      } catch (err) {
        console.error('Failed to fetch dashboard data:', err)
        setError('加载数据失败，请稍后重试')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  // 从 BFF 响应中计算统计数据
  const agentStats = stats?.agents || { total: 0, idle: 0, busy: 0 }
  const taskStats = stats?.tasks || { total: 0, by_status: {} }
  const toolStats = stats?.tools || { total: 0, enabled: 0 }
  const memoryStats = stats?.memory || { session_count: 0, total_session_messages: 0 }

  const activeAgents = agentStats.idle + agentStats.busy
  const runningTasks = taskStats.by_status['running'] || 0
  const completedTasks = taskStats.by_status['completed'] || 0

  // 任务状态分布数据
  const taskStatusData = Object.entries(taskStats.by_status || {})
    .map(([name, value]) => ({ name, value }))
    .filter(item => item.value > 0)

  // 模拟活动数据
  const activityData = [
    { time: '00:00', tasks: 4, agents: 2 },
    { time: '04:00', tasks: 3, agents: 2 },
    { time: '08:00', tasks: 8, agents: 5 },
    { time: '12:00', tasks: 12, agents: 8 },
    { time: '16:00', tasks: 10, agents: 6 },
    { time: '20:00', tasks: 6, agents: 4 },
    { time: '23:59', tasks: 5, agents: 3 },
  ]

  const statCards = [
    {
      title: '智能体',
      value: agentStats.total,
      active: activeAgents,
      icon: Bot,
      color: 'from-primary-500 to-primary-600',
      bgColor: 'bg-primary-500/10',
      textColor: 'text-primary-400'
    },
    {
      title: '任务',
      value: taskStats.total,
      active: runningTasks,
      icon: ListTodo,
      color: 'from-accent-cyan to-cyan-600',
      bgColor: 'bg-accent-cyan/10',
      textColor: 'text-accent-cyan'
    },
    {
      title: '工具',
      value: toolStats.total,
      active: toolStats.enabled,
      icon: Wrench,
      color: 'from-accent-purple to-purple-600',
      bgColor: 'bg-accent-purple/10',
      textColor: 'text-accent-purple'
    },
    {
      title: '会话',
      value: memoryStats.session_count,
      active: memoryStats.total_session_messages,
      icon: Brain,
      color: 'from-accent-pink to-pink-600',
      bgColor: 'bg-accent-pink/10',
      textColor: 'text-accent-pink'
    },
  ]

  // 最近任务列表 - 使用 BFF 返回的 recent_list
  const recentTasks = tasks.slice(0, 5)

  return (
    <div className="space-y-6">
      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
          <span className="ml-3 text-slate-400">加载中...</span>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="glass rounded-xl p-6 text-center">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {/* Stats Cards */}
      {!loading && !error && (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((card, index) => (
          <div 
            key={index}
            className="glass rounded-xl p-6 card-hover"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-slate-400 text-sm">{card.title}</p>
                <div className="flex items-baseline gap-2 mt-2">
                  <h3 className="text-3xl font-bold text-slate-100">{card.value}</h3>
                  {card.active > 0 && (
                    <span className={`text-xs ${card.textColor}`}>
                      {card.active} 活跃
                    </span>
                  )}
                </div>
              </div>
              <div className={`w-12 h-12 rounded-xl ${card.bgColor} flex items-center justify-center`}>
                <card.icon className={`w-6 h-6 ${card.textColor}`} />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <span className="text-sm text-emerald-400">+12%</span>
              <span className="text-sm text-slate-500">较上周</span>
            </div>
          </div>
        ))}
      </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Activity Chart */}
        <div className="glass rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Activity className="w-5 h-5 text-primary-400" />
              <h3 className="text-lg font-semibold text-slate-100">活动趋势</h3>
            </div>
            <select className="bg-dark-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-300">
              <option>最近24小时</option>
              <option>最近7天</option>
              <option>最近30天</option>
            </select>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activityData}>
                <defs>
                  <linearGradient id="colorTasks" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorAgents" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="time" stroke="#64748b" fontSize={12} />
                <YAxis stroke="#64748b" fontSize={12} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#1e293b', 
                    border: '1px solid #334155',
                    borderRadius: '8px'
                  }}
                />
                <Area type="monotone" dataKey="tasks" stroke="#6366f1" fillOpacity={1} fill="url(#colorTasks)" />
                <Area type="monotone" dataKey="agents" stroke="#06b6d4" fillOpacity={1} fill="url(#colorAgents)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Task Status Distribution */}
        <div className="glass rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-accent-purple" />
              <h3 className="text-lg font-semibold text-slate-100">任务状态分布</h3>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={taskStatusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {taskStatusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#1e293b', 
                    border: '1px solid #334155',
                    borderRadius: '8px'
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap justify-center gap-4 mt-4">
            {taskStatusData.map((entry, index) => (
              <div key={entry.name} className="flex items-center gap-2">
                <div 
                  className="w-3 h-3 rounded-full" 
                  style={{ backgroundColor: COLORS[index % COLORS.length] }}
                />
                <span className="text-sm text-slate-400">{entry.name}: {entry.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      {!loading && !error && tasks.length > 0 && (
      <div className="glass rounded-xl p-6">
        <h3 className="text-lg font-semibold text-slate-100 mb-4">最近活动</h3>
        <div className="space-y-3">
          {recentTasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center justify-between p-3 bg-dark-800/50 rounded-lg hover:bg-dark-800 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${
                  task.status === 'completed' ? 'bg-emerald-400' :
                  task.status === 'running' ? 'bg-amber-400' :
                  task.status === 'failed' ? 'bg-red-400' :
                  'bg-slate-400'
                }`} />
                <div>
                  <p className="text-sm font-medium text-slate-200">{task.title}</p>
                  <p className="text-xs text-slate-500">{new Date(task.created_at).toLocaleString()}</p>
                </div>
              </div>
              <span className={`px-2 py-1 rounded-full text-xs ${
                task.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                task.status === 'running' ? 'bg-amber-500/10 text-amber-400' :
                task.status === 'failed' ? 'bg-red-500/10 text-red-400' :
                'bg-slate-500/10 text-slate-400'
              }`}>
                {task.status}
              </span>
            </div>
          ))}
        </div>
      </div>
      )}
    </div>
  )
}
