# Axi Agent Platform Desktop Glass UI

macOS desktop shell prototype for the Axi Agent Platform. It uses React, Vite, TypeScript, Electron, and CSS design tokens to reproduce a single transparent glass window surface.

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
