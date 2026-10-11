# Axi Agent Platform Desktop Glass UI

macOS desktop shell prototype for the Axi Agent Platform. It uses React, Vite, TypeScript, Electron, and CSS design tokens to reproduce a single transparent glass window surface.

> **Authoritative entry**: see [`AGENTS.md`](AGENTS.md) for the canonical project rules
> (entry points, transparency model, command catalog, related modules). This
> README mirrors that content in English for repo-root discoverability.

## Commands

```bash
pnpm install
pnpm build
pnpm dev
pnpm app:mac
```

`pnpm app:mac` creates a local macOS test app at `release/mac-arm64/Axi Agent Platform.app`. It disables automatic signing identity discovery so local packaging does not block on workstation-specific code-signing state.

## Transparency Model

The browser preview renders a fixed wallpaper behind the glass surface. The packaged app has no bundled background; the transparent window composites directly over whatever is behind it on the desktop. For accurate visual comparison, place the app over the same image or window used in the browser preview.

The native shell uses `-webkit-app-region: drag` so the glass surface itself moves the macOS window. Interactive controls are marked as no-drag regions.

## Entry Points

| File | Role |
|------|------|
| `electron/main.ts` | Electron main process entry |
| `src/App.tsx` | React root component |
| `src/index.css` | Glass-surface styles |

## Related Modules

- `../frontend/`: Web frontend reference implementation for parity.
- Project root: see `../../AGENTS.md` for cross-project boundaries.

*Last refreshed: 2026-10-11 (M18 doc-cleanup wave — synced to AGENTS.md 2026-09-17).*
