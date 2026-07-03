import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// The editor SPA lives in src/app; `vite build` emits dist/app which the
// local server (`token-vault dev`) serves statically. During development
// `pnpm dev:app` proxies API/WS calls to a running `token-vault dev`.
export default defineConfig({
  root: "src/app",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/app"),
      "@core": path.resolve(__dirname, "src/core"),
      "@schema": path.resolve(__dirname, "src/schema"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist/app"),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:4477",
      "/ws": { target: "ws://localhost:4477", ws: true },
    },
  },
});
