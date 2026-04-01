import {
    Info,
    Bot,
    History,
    Settings,
    ChevronRight,
    ChevronLeft
} from 'lucide-react'
import { useUIStore } from '@/store'
import { cn } from '@/utils/cn'

export default function RightSidebar({ collapsedWidth = 'w-16' }: { collapsedWidth?: string }) {
    const { rightSidebarOpen, setRightSidebarOpen } = useUIStore()

    const navButtons = [
        { icon: Info, title: "协助信息", color: "hover:text-primary-400" },
        { icon: Bot, title: "任务详情", color: "hover:text-primary-400" },
        { icon: History, title: "历史记录", color: "hover:text-accent-cyan" },
        { icon: Settings, title: "本地设置", color: "hover:text-accent-purple" },
    ]

    return (
        <aside
            className={cn(
                "bg-dark-900 border-l border-dark-700 transition-all duration-300 flex flex-col relative shrink-0 overflow-visible",
                rightSidebarOpen ? collapsedWidth : "w-0 border-none"
            )}
        >
            {/* Button Stack Container - Persistent at the far right, perfectly centered */}
            <div className="absolute top-0 right-0 w-12 h-full flex flex-col items-center justify-end p-0 pb-[10px] space-y-[10px]">
                {/* Functional Buttons - Hidden when collapsed */}
                <div className={cn(
                    "flex flex-col items-center space-y-[10px] transition-all duration-300 flex-1 justify-end",
                    !rightSidebarOpen ? "opacity-0 pointer-events-none -translate-x-4" : "opacity-100"
                )}>
                    {navButtons.map((btn, idx) => (
                        <button
                            key={idx}
                            className={cn(
                                "w-10 h-10 flex items-center justify-center rounded border border-dark-700",
                                "text-slate-500 transition-all hover:bg-dark-800 hover:border-dark-600 shadow-sm",
                                "hover:scale-105 active:scale-95",
                                btn.color
                            )}
                            title={btn.title}
                        >
                            <btn.icon className="w-5 h-5 transition-colors" />
                        </button>
                    ))}
                </div>

                {/* Toggle Button - Always Visible, at the bottom of the stack, perfectly centered */}
                <button
                    onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
                    className="w-10 h-10 flex items-center justify-center rounded border border-dark-700 bg-dark-900 text-slate-500 hover:text-slate-200 hover:bg-dark-800 transition-all hover:scale-110 active:scale-95 shadow-md"
                    title={rightSidebarOpen ? "折叠" : "展开"}
                >
                    {rightSidebarOpen ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                </button>
            </div>
        </aside>
    )
}
