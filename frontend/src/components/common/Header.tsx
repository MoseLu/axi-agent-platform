import { Bell, Search, User, Maximize2, RefreshCw } from 'lucide-react'

export default function Header() {
  return (
    <div className="flex items-center justify-between flex-1 pl-4 shrink-0 relative z-10">
      {/* Search Area */}
      <div className="flex items-center flex-1 max-w-xl">
        <div className="relative w-full group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 group-focus-within:text-primary-500 transition-colors" />
          <input
            type="text"
            placeholder="搜索关键词..."
            className="w-full pl-9 pr-4 py-1.5 bg-dark-900/40 border border-dark-700/50 rounded text-[11px] text-slate-300 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30 focus:border-primary-500/30 transition-all font-medium"
          />
        </div>
      </div>

      {/* Right side: Actions & User */}
      <div className="flex items-center gap-0.5 ml-4 text-slate-400">
        <button className="p-2 hover:bg-dark-700 hover:text-slate-200 rounded transition-all group" title="刷新">
          <RefreshCw className="w-3.5 h-3.5 group-active:rotate-180 transition-transform duration-500" />
        </button>
        <button className="p-2 hover:bg-dark-700 hover:text-slate-200 rounded transition-all" title="全屏">
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        <button className="relative p-2 hover:bg-dark-700 hover:text-slate-200 rounded transition-all" title="消息">
          <Bell className="w-3.5 h-3.5" />
          <span className="absolute top-2.5 right-2.5 w-1 h-1 bg-red-500 rounded-full" />
        </button>

        {/* Divider */}
        <div className="w-[1px] h-4 bg-dark-700 mx-3" />

        <button className="flex items-center gap-2 pl-3 pr-1 py-1 rounded hover:bg-dark-700 transition-all group">
          <span className="text-[11px] font-bold text-slate-400 group-hover:text-slate-200 transition-colors uppercase tracking-tight">管理员</span>
          <div className="w-7 h-7 rounded bg-primary-500/10 border border-primary-500/20 flex items-center justify-center overflow-hidden transition-all group-hover:border-primary-500/40 group-hover:bg-primary-500/20">
            <User className="w-3.5 h-3.5 text-primary-400 group-hover:text-primary-300" />
          </div>
        </button>
      </div>
    </div>
  )
}
