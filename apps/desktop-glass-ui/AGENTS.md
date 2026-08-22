# AGENTS.md - Axi Agent Platform Desktop Glass UI

## 模块职责

macOS 桌面壳原型，使用 Electron + React + TypeScript 实现玻璃态透明窗口，模拟 Axi Agent Platform 的桌面端界面。

## 边界定义

- **输入**: 无后台服务依赖
- **输出**: macOS 原生窗口应用
- **技术栈**:
  - Electron (桌面壳)
  - React 18 + TypeScript
  - Vite (构建工具)
  - CSS 设计令牌

## 入口点

| 文件 | 说明 |
|------|------|
| `electron/main.ts` | Electron 主进程入口 |
| `src/App.tsx` | React 根组件 |
| `src/index.css` | 玻璃态样式 |

## 透明度模型

- **浏览器预览**: 渲染固定壁纸背景
- **打包应用**: 透明窗口直接合成在桌面内容之上
- **拖拽区域**: 使用 `-webkit-app-region: drag`，交互控件标记为 no-drag

## 命令

```bash
pnpm install     # 安装依赖
pnpm dev         # 开发模式
pnpm build       # 构建
pnpm app:mac     # 打包 macOS 应用
```

## 相关模块

- `axi-agent-platform/frontend/`: Web 前端参考实现
- 父项目: `axi-agent-platform/`
