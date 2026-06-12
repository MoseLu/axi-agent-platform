import type { CSSProperties, ReactNode } from 'react'
import { PanelLeft } from 'lucide-react'
import Sidebar from './Sidebar'
import { useUIStore } from '@/store'
import { cn } from '@/utils/cn'

interface LayoutProps {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { backendLabel, glassLevel, sidebarOpen, setSidebarOpen } = useUIStore()
  const isDesktopShell = new URLSearchParams(window.location.search).get('shell') === 'mac'

  const glassStyle = {
    '--glass-alpha': (
      (isDesktopShell ? 0.12 : 0.055) + glassLevel / (isDesktopShell ? 420 : 520)
    ).toFixed(3),
    '--glass-soft-alpha': (
      (isDesktopShell ? 0.09 : 0.045) + glassLevel / (isDesktopShell ? 560 : 680)
    ).toFixed(3),
    '--glass-sidebar-alpha': (0.17 + glassLevel / 360).toFixed(3),
    '--glass-sidebar-soft-alpha': (0.15 + glassLevel / 430).toFixed(3),
    '--glass-blur': `${Math.round(1 + glassLevel * 0.06)}px`,
    '--glass-sidebar-blur': `${Math.round(2 + glassLevel * 0.18)}px`,
  } as CSSProperties

  return (
    <div className="glass-shell text-ink">
      <section
        className={cn('glass-window', !sidebarOpen && 'glass-window-rail')}
        style={glassStyle}
      >
        <Sidebar />

        <div className="relative z-10 min-w-0 overflow-hidden">
          <header className="pointer-events-none absolute left-4 right-6 top-4 z-30 flex h-9 items-center justify-between md:left-6">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              data-no-drag="true"
              className="glass-control pointer-events-auto grid h-9 w-9 place-items-center text-ink-muted hover:text-ink"
              title={sidebarOpen ? '折叠侧边栏' : '展开侧边栏'}
              type="button"
            >
              <PanelLeft
                className={cn(
                  'h-4 w-4 transition-transform',
                  !sidebarOpen && 'rotate-180',
                )}
              />
            </button>
            <div className="text-xs text-ink-muted/60">
              Active: {backendLabel} · Thinking off
            </div>
          </header>

          <main
            className="h-full min-h-0 overflow-auto px-5 pb-6 pt-14 md:px-8 scrollbar-thin"
            data-no-drag="true"
          >
            {children}
          </main>
        </div>
      </section>
    </div>
  )
}
