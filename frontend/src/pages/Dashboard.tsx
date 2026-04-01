import { useEffect } from 'react'
import { 
  Bot, 
  ListTodo, 
  Wrench, 
  Brain,
  TrendingUp,
  Activity,
  Clock
} from 'lucide-react'
import { useAgentsStore, useTasksStore, useToolsStore, useSystemStore } from '../store'
import { agentsApi, tasksApi, toolsApi, systemApi } from '../services/api'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'

const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#06b6d4', '#10b981', '#f59e0b']

export default function Dashboard() {
  const { agents, setAgents } = useAgentsStore()
  const { tasks, setTasks } = useTasksStore()
  const { tools, setTools } = useToolsStore()
  const { stats, setStats } = useSystemStore()

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [agentsRes, tasksRes, toolsRes, statsRes] = await Promise.all([
          agentsApi.list(),
          tasksApi.list(),
          toolsApi.list(),
          systemApi.getStats()
        ])
        setAgents(agentsRes.data)
        setTasks(tasksRes.data)
        setTools(toolsRes.data)
        setStats(statsRes.data)
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error)
      }
    }

    fetchData()
  }, [setAgents, setTasks, setTools, setStats])

  // 计算统计数据
  const activeAgents = agents.filter(a => a.status === 'idle' || a.status === 'busy').length
  const runningTasks = tasks.filter(t => t.status === 'running').length
  const enabledTools = tools.filter(t => t.enabled).length
  const completedTasks = tasks.filter(t => t.status === 'completed').length

  // 任务状态分布数据
  const taskStatusData = stats?.tasks.by_status 
    ? Object.entries(stats.tasks.by_status).map(([name, value]) => ({ name, value }))
    : []

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
      value: agents.length, 
      active: activeAgents,
      icon: Bot, 
      color: 'from-primary-500 to-primary-600',
      bgColor: 'bg-primary-500/10',
      textColor: 'text-primary-400'
    },
    { 
      title: '任务', 
      value: tasks.length, 
      active: runningTasks,
      icon: ListTodo, 
      color: 'from-accent-cyan to-cyan-600',
      bgColor: 'bg-accent-cyan/10',
      textColor: 'text-accent-cyan'
    },
    { 
      title: '工具', 
      value: tools.length, 
      active: enabledTools,
      icon: Wrench, 
      color: 'from-accent-purple to-purple-600',
      bgColor: 'bg-accent-purple/10',
      textColor: 'text-accent-purple'
    },
    { 
      title: '会话', 
      value: stats?.memory.session_count || 0, 
      active: stats?.memory.total_session_messages || 0,
      icon: Brain, 
      color: 'from-accent-pink to-pink-600',
      bgColor: 'bg-accent-pink/10',
      textColor: 'text-accent-pink'
    },
  ]

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
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
      <div className="glass rounded-xl p-6">
        <h3 className="text-lg font-semibold text-slate-100 mb-4">最近活动</h3>
        <div className="space-y-3">
          {tasks.slice(0, 5).map((task) => (
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
          {tasks.length === 0 && (
            <div className="text-center py-8 text-slate-500">
              暂无活动记录
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
