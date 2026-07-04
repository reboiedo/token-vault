import { defineConfig } from "tsup";

// Node-side build: CLI, server, store, MCP. The SPA under src/app is
// built separately by Vite into dist/app and served statically.
export default defineConfig({
  entry: {
    "cli/index": "src/cli/index.ts",
    "mcp/index": "src/mcp/index.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  splitting: true,
  clean: false,
  dts: false,
  sourcemap: true,
});
