import type { CSSProperties, PointerEvent } from "react";
import { useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  AtSign,
  ChevronRight,
  Circle,
  Command,
  Diamond,
  Hash,
  Plus,
  Search,
  Settings,
} from "lucide-react";

const navItems = [
  { label: "会话", icon: Circle, active: true },
  { label: "App 生成", icon: Diamond },
  { label: "搜索", icon: Search },
  { label: "插件", icon: Command },
  { label: "自动化", icon: ChevronRight },
  { label: "项目", icon: Hash },
];

type WindowOffset = {
  x: number;
  y: number;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

const isDragExcluded = (target: EventTarget | null) =>
  target instanceof Element &&
  Boolean(
    target.closest(
      "button, input, label, a, textarea, select, [data-no-drag='true']",
    ),
  );

function Wallpaper() {
  return (
    <div className="wallpaper" aria-hidden="true">
      <img
        className="wallpaper-frame"
        src="/assets/mountain-wallpaper.png"
        alt=""
      />
      <div className="grain" />
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="sidebar" aria-label="Chat workspace">
      <div className="brand-row">
        <span className="brand-mark">AI</span>
        <span className="brand-title">AI Chat</span>
      </div>
      <p className="workspace-label">Chat workspace</p>

      <nav className="nav-list">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={item.active ? "nav-item nav-item-active" : "nav-item"}
              key={item.label}
              type="button"
            >
              <Icon size={15} strokeWidth={1.8} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-faded">
        <span>对话</span>
        <span>暂无聊天</span>
      </div>

      <button className="settings-link" type="button">
        <Settings size={15} />
        <span>设置</span>
      </button>
    </aside>
  );
}

function TopControls({
  glass,
  onGlassChange,
}: {
  glass: number;
  onGlassChange: (value: number) => void;
}) {
  return (
    <div className="top-controls" aria-label="Session controls">
      <div className="segmented-control">
        <span>Backend</span>
        <strong>Moonshot</strong>
      </div>
      <label className="glass-meter">
        <span>Glass</span>
        <input
          aria-label="Glass opacity"
          onChange={(event) => onGlassChange(Number(event.currentTarget.value))}
          value={glass}
          max="100"
          min="0"
          type="range"
        />
        <strong>{glass}%</strong>
      </label>
    </div>
  );
}

function Composer() {
  return (
    <section className="composer" aria-label="Message composer">
      <div className="composer-prompt">问任何事。输入 @ 使用插件或提及文件</div>
      <div className="composer-actions">
        <div className="tool-row" aria-label="Composer tools">
          <button className="icon-button" type="button" aria-label="Add">
            <Plus size={17} />
          </button>
          <button className="icon-button" type="button" aria-label="Mention">
            <AtSign size={17} />
          </button>
          <button className="icon-button" type="button" aria-label="Command">
            <Command size={17} />
          </button>
          <span className="permission">默认权限</span>
          <span className="thinking-dot" />
          <span className="thinking-label">Thinking</span>
        </div>
        <div className="send-row">
          <button className="clear-button" type="button">
            Clear
          </button>
          <button className="send-button" type="button" aria-label="Send">
            <ArrowUp size={24} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </section>
  );
}

function App() {
  const isMacShell =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("shell") === "mac";
  const [glass, setGlass] = useState(10);
  const [windowOffset, setWindowOffset] = useState<WindowOffset>({
    x: 0,
    y: 0,
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragStateRef = useRef<DragState | null>(null);

  const glassStyle = useMemo(
    () =>
      ({
        "--glass-alpha": (0.055 + glass / 520).toFixed(3),
        "--glass-soft-alpha": (0.045 + glass / 680).toFixed(3),
        "--glass-sidebar-alpha": (0.17 + glass / 360).toFixed(3),
        "--glass-sidebar-soft-alpha": (0.15 + glass / 430).toFixed(3),
        "--glass-blur": `${Math.round(1 + glass * 0.06)}px`,
        "--glass-sidebar-blur": `${Math.round(2 + glass * 0.18)}px`,
        "--window-x": `${isMacShell ? 0 : windowOffset.x}px`,
        "--window-y": `${isMacShell ? 0 : windowOffset.y}px`,
      }) as CSSProperties,
    [glass, isMacShell, windowOffset.x, windowOffset.y],
  );

  const handleWindowPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (isMacShell || event.button !== 0 || isDragExcluded(event.target)) {
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: windowOffset.x,
      originY: windowOffset.y,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events used in browser verification may not own capture.
    }
    setIsDragging(true);
  };

  const handleWindowPointerMove = (event: PointerEvent<HTMLElement>) => {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    setWindowOffset({
      x: dragState.originX + event.clientX - dragState.startX,
      y: dragState.originY + event.clientY - dragState.startY,
    });
  };

  const stopWindowDrag = (event: PointerEvent<HTMLElement>) => {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore capture release mismatches from synthetic verification events.
    }

    dragStateRef.current = null;
    setIsDragging(false);
  };

  return (
    <main
      className={isMacShell ? "desktop-shell desktop-shell-native" : "desktop-shell"}
    >
      {!isMacShell && <Wallpaper />}
      <section
        className={[
          "window-frame",
          isMacShell ? "window-frame-native" : "",
          isDragging && !isMacShell ? "window-frame-dragging" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-label="AI Chat desktop window"
        onPointerCancel={isMacShell ? undefined : stopWindowDrag}
        onPointerDown={isMacShell ? undefined : handleWindowPointerDown}
        onPointerMove={isMacShell ? undefined : handleWindowPointerMove}
        onPointerUp={isMacShell ? undefined : stopWindowDrag}
        style={glassStyle}
      >
        <Sidebar />
        <div className="main-pane">
          <header className="pane-header">
            <h1>AI Chat</h1>
            <TopControls glass={glass} onGlassChange={setGlass} />
          </header>

          <section className="hero-copy" aria-live="polite">
            <p className="question">我们该做什么？</p>
            <p className="hint">输入自然语言，生成可交互的 Makepad diagram。</p>
          </section>

          <Composer />
          <footer className="status-line">Active: Moonshot · Thinking off</footer>
        </div>
      </section>
    </main>
  );
}

export default App;
