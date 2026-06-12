import { NavLink } from 'react-router-dom'
import {
  Bot,
  ChevronRight,
  Circle,
  Command,
  Diamond,
  Hash,
  Search,
  Settings,
} from 'lucide-react'
import { useUIStore } from '@/store'
import { cn } from '@/utils/cn'

const menuItems = [
  { path: '/', icon: Circle, label: '会话' },
  { path: '/dashboard', icon: Diamond, label: '概览' },
  { path: '/agents', icon: Bot, label: '智能体' },
  { path: '/tools', icon: Command, label: '插件' },
  { path: '/tasks', icon: ChevronRight, label: '自动化' },
  { path: '/memory', icon: Hash, label: '记忆' },
]

export default function Sidebar() {
  const { sidebarOpen, setCurrentPage } = useUIStore()

  return (
    <aside
      className={cn(
        'glass-sidebar window-drag-region relative z-10 grid grid-rows-[auto_auto_1fr_auto] border-r border-white/10 px-7 py-6 transition-all duration-300',
        sidebarOpen ? 'w-sidebar' : 'w-sidebar-rail justify-items-center px-3',
      )}
      aria-label="Axi Agent Platform workspace"
    >
      <div
        className={cn(
          'flex min-h-9 items-center gap-4 font-display font-bold',
          !sidebarOpen && 'justify-center gap-0',
        )}
      >
        <span className="text-lg text-cyan-300">AI</span>
        {sidebarOpen && <span className="sidebar-label text-lg text-ink">AI Chat</span>}
      </div>

      {sidebarOpen && (
        <p className="sidebar-label mt-4 text-sm text-ink-muted/70">Chat workspace</p>
      )}

      <nav className="mt-8 grid w-full gap-2">
        {menuItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={() => setCurrentPage(item.label)}
            title={item.label}
            className={({ isActive }) =>
              cn(
                'flex min-h-[42px] items-center gap-3 rounded-full px-4 text-sm text-ink-muted/75 transition-all duration-200 hover:bg-white/10 hover:text-ink',
                isActive &&
                  'bg-gradient-to-r from-teal-600/80 to-teal-700/45 text-ink shadow-inner',
                !sidebarOpen && 'mx-auto h-[46px] w-[46px] justify-center px-0',
              )
            }
          >
            <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
            {sidebarOpen && <span className="sidebar-label font-medium">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {sidebarOpen && (
        <div className="sidebar-faded self-end pb-10 text-sm text-ink-muted/35">
          <p>对话</p>
          <p className="mt-4">暂无聊天</p>
        </div>
      )}

      <NavLink
        to="/settings"
        onClick={() => setCurrentPage('设置')}
        title="设置"
        className={({ isActive }) =>
          cn(
            'flex min-h-[42px] items-center gap-3 rounded-full px-3 text-sm text-ink-muted/80 transition-all hover:bg-white/10 hover:text-ink',
            isActive && 'bg-white/10 text-ink',
            !sidebarOpen && 'h-[46px] w-[46px] justify-center px-0',
          )
        }
      >
        <Settings className="h-4 w-4" />
        {sidebarOpen && <span className="sidebar-label">设置</span>}
      </NavLink>

      <Search className="pointer-events-none absolute bottom-6 right-6 hidden h-4 w-4 text-white/10" />
    </aside>
  )
}
