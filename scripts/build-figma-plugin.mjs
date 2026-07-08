// Builds the Figma plugin into dist/figma-plugin/ so it ships in the npm
// tarball (`files` includes dist). Two passes, same as the original plugin
// repo: an IIFE bundle for the sandbox entry (main.js) and a single-file
// HTML for the iframe UI (ui.html). The manifest is copied alongside with
// its main/ui rewritten to bare relative paths for Figma's
// "Import plugin from manifest".
import { build } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(repoRoot, "figma-plugin");
const outDir = path.join(repoRoot, "dist", "figma-plugin");

// Pass 1 — sandbox code: dist/figma-plugin/main.js
await build({
  configFile: false,
  root: pluginRoot,
  logLevel: "warn",
  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: false,
    target: "es6",
    minify: true,
    lib: {
      entry: path.join(pluginRoot, "src", "main.ts"),
      name: "main",
      fileName: () => "main.js",
      formats: ["iife"],
    },
    rollupOptions: { output: { extend: true } },
  },
});

// Pass 2 — iframe UI: dist/figma-plugin/ui.html (single file, assets inlined)
await build({
  configFile: false,
  root: pluginRoot,
  logLevel: "warn",
  plugins: [viteSingleFile()],
  build: {
    outDir,
    emptyOutDir: false,
    sourcemap: false,
    target: "es6",
    minify: true,
    rollupOptions: { input: path.join(pluginRoot, "src", "ui.html") },
  },
});
// The html entry keeps its src/ prefix relative to the plugin root.
await rename(path.join(outDir, "src", "ui.html"), path.join(outDir, "ui.html"));
await rm(path.join(outDir, "src"), { recursive: true, force: true });

// Manifest: same as the source manifest, but main/ui point at siblings.
const manifest = JSON.parse(await readFile(path.join(pluginRoot, "manifest.json"), "utf8"));
manifest.main = "main.js";
manifest.ui = "ui.html";
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

console.log("[figma-plugin] built dist/figma-plugin/{manifest.json,main.js,ui.html}");
