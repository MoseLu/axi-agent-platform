import { ReactNode } from 'react'
import Sidebar from './Sidebar'
import Header from './Header'
import RightSidebar from './RightSidebar'
import { useUIStore } from '@/store'
import {
  X,
  PanelLeft,
  Bot,
  RotateCcw,
  ChevronDown,
  MinusCircle,
  XCircle,
  MoreVertical,
  LayoutGrid
} from 'lucide-react'
import { cn } from '@/utils/cn'

interface LayoutProps {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { sidebarOpen, setSidebarOpen } = useUIStore()

  const barHeight = "h-12"
  const sideWidthCollapsed = "w-12"

  return (
    <div className="flex flex-col h-screen bg-dark-950 overflow-hidden text-slate-300">
      {/* 1. Header - Full Width */}
      <header className={cn(barHeight, "bg-dark-900 border-b border-dark-700 flex items-center px-4 shrink-0 z-30 shadow-sm gap-4")}>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 rounded hover:bg-dark-800 text-slate-500 hover:text-slate-200 transition-all"
          >
            <PanelLeft className={cn("w-4.5 h-4.5 transition-transform duration-300", !sidebarOpen && "rotate-180")} />
          </button>

          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded bg-primary-500 flex items-center justify-center shrink-0 shadow-lg shadow-primary-500/20">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-slate-200 tracking-tight text-sm hidden sm:block">AGENT SWARM</span>
          </div>
        </div>

        <div className="flex-1" />

        <Header />
      </header>

      {/* 2. Container (Below Header) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <Sidebar collapsedWidth={sideWidthCollapsed} />

        {/* Middle Column */}
        <div className="flex-1 flex flex-col min-w-0 bg-dark-950">
          {/* Process Bar (TabBar) */}
          <div className={cn(barHeight, "border-b border-dark-700 bg-dark-900 flex items-center px-2 shrink-0 justify-between")}>
            <div className="flex items-center overflow-x-auto no-scrollbar gap-1.5 flex-1 h-full py-2">
              <div className="flex items-center gap-2 h-full px-3 bg-primary-500 text-white rounded-sm text-[11px] font-bold cursor-pointer transition-all shrink-0">
                <LayoutGrid className="w-3 h-3" />
                <span>主页</span>
              </div>
              <div className="flex items-center gap-2 h-full px-3 bg-dark-800 border border-dark-700 text-slate-500 text-[11px] hover:text-slate-200 cursor-pointer transition-all group rounded-sm shrink-0">
                <span>任务列表</span>
                <X className="w-3 h-3 opacity-0 group-hover:opacity-100 hover:bg-dark-700 rounded-full transition-opacity" />
              </div>
            </div>

            {/* Cool-admin Tab Controls (5 Buttons) */}
            <div className="flex items-center border-l border-dark-700 pl-2 h-8 gap-0.5 text-slate-500">
              <button className="p-1.5 hover:text-primary-500 hover:bg-dark-800 rounded transition-all" title="刷新当前">
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button className="p-1.5 hover:text-primary-500 hover:bg-dark-800 rounded transition-all" title="关闭其他">
                <MinusCircle className="w-3.5 h-3.5" />
              </button>
              <button className="p-1.5 hover:text-red-500 hover:bg-dark-800 rounded transition-all" title="关闭所有">
                <XCircle className="w-3.5 h-3.5" />
              </button>
              <button className="p-1.5 hover:text-primary-500 hover:bg-dark-800 rounded transition-all" title="侧边选项">
                <MoreVertical className="w-3.5 h-3.5" />
              </button>
              <button className="p-1.5 hover:text-primary-500 hover:bg-dark-800 rounded transition-all" title="更多">
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Breadcrumbs Bar - Below Process */}
          <div className={cn(barHeight, "border-b border-dark-700 bg-dark-900/40 flex items-center px-4 shrink-0")}>
            <nav className="flex text-[10px] text-slate-500 uppercase tracking-[0.2em] font-black" aria-label="Breadcrumb">
              <ol className="flex items-center space-x-2">
                <li><span className="hover:text-primary-400 cursor-pointer transition-colors">PROJECT</span></li>
                <li className="text-dark-600">/</li>
                <li className="text-slate-400">DASHBOARD</li>
              </ol>
            </nav>
          </div>

          {/* Core Content Area */}
          <main className="flex-1 overflow-auto p-4 scrollbar-thin">
            {children}
          </main>
        </div>

        {/* Right Sidebar */}
        <RightSidebar collapsedWidth={sideWidthCollapsed} />
      </div>
    </div>
  )
}
