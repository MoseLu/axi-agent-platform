import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  MessageSquare,
  Settings,
  Bot
} from 'lucide-react'
import { useUIStore } from '@/store'
import { cn } from '@/utils/cn'

const menuItems = [
  { path: '/', icon: MessageSquare, label: '对话' },
  { path: '/dashboard', icon: LayoutDashboard, label: '概览' },
  { path: '/settings', icon: Settings, label: '设置' },
]

export default function Sidebar({ collapsedWidth = 'w-16' }: { collapsedWidth?: string }) {
  const { sidebarOpen, setCurrentPage } = useUIStore()

  return (
    <aside
      className={cn(
        sidebarOpen ? 'w-64' : collapsedWidth,
        "bg-dark-900 border-r border-dark-700 transition-all duration-300 flex flex-col relative shrink-0"
      )}
    >
      {/* Navigation */}
      <nav className="flex-1 py-4 px-0 space-y-1">
        {menuItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={() => setCurrentPage(item.label)}
            className={({ isActive }) => cn(
              "flex items-center gap-3 px-3 py-2 rounded-none transition-all duration-200 text-sm border-l-2",
              isActive
                ? 'bg-primary-500/10 text-primary-400 border-primary-500 shadow-sm'
                : 'text-slate-400 hover:bg-dark-800 hover:text-slate-200 border-transparent',
              !sidebarOpen && 'justify-center px-0'
            )}
          >
            <item.icon className="w-4 h-4 flex-shrink-0" />
            {sidebarOpen && <span className="font-medium">{item.label}</span>}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
