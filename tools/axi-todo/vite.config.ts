import { defineConfig } from "vite";
import type { PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { axi } from "/Volumes/code/workspace/shared/axi-ui/packages/vite-plugin/dist/index.js";

const axiUiRoot = "/Volumes/code/workspace/shared/axi-ui/packages";
const maxChunkSizeBytes = 1_000_000;
const axiPlugins = axi({ chunkGuard: { maxChunkSizeBytes } }) as unknown as PluginOption[];

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist-web",
    emptyOutDir: true,
  },
  plugins: [react(), ...axiPlugins],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      { find: "@axi/core/styles.css", replacement: `${axiUiRoot}/core/dist/styles.css` },
      { find: "@axi/core", replacement: `${axiUiRoot}/core/src/index.ts` },
      { find: "@axi/crud/styles.css", replacement: `${axiUiRoot}/crud/dist/styles.css` },
      { find: "@axi/crud", replacement: `${axiUiRoot}/crud/src/index.ts` },
      { find: "@axi/settings/styles.css", replacement: `${axiUiRoot}/settings/dist/styles.css` },
      { find: "@axi/settings", replacement: `${axiUiRoot}/settings/src/index.ts` },
      { find: "@axi/widgets/styles.css", replacement: `${axiUiRoot}/widgets/dist/styles.css` },
      { find: "@axi/widgets", replacement: `${axiUiRoot}/widgets/src/index.ts` },
      { find: "@axi/shell/styles.css", replacement: `${axiUiRoot}/shell/dist/styles.css` },
      { find: "@axi/shell", replacement: `${axiUiRoot}/shell/src/index.ts` },
      { find: /^@axi\/tokens\/brand\/app-icons\/(.+\.svg)$/, replacement: `${axiUiRoot}/tokens/dist/brand/app-icons/$1` },
      { find: "@axi/tokens/css", replacement: `${axiUiRoot}/tokens/dist/css/variables.css` },
      { find: "@axi/tokens/ts", replacement: `${axiUiRoot}/tokens/dist/ts/tokens.js` },
    ],
  },
});
