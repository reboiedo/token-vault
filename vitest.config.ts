import { defineConfig } from "vitest/config";
import path from "node:path";

// Standalone vitest config: vite.config.ts sets `root: "src/app"` for
// the SPA build, which would hide the node-side tests under tests/.
export default defineConfig({
  resolve: {
    alias: {
      "@core": path.resolve(__dirname, "src/core"),
      "@schema": path.resolve(__dirname, "src/schema"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
