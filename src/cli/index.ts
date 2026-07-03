#!/usr/bin/env node
/**
 * token-vault CLI.
 *
 *   token-vault dev    — run the local editor on your design-system/ folder
 *   token-vault build  — emit dist/tokens.json + dist/$metadata.json (DTCG)
 *   token-vault check  — validate the source files (CI-friendly)
 *   token-vault init   — scaffold a design-system/ folder   (F3)
 *   token-vault mcp    — MCP stdio server over the files     (F4)
 */

import { Command } from "commander";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FileStore, DesignSystemError } from "../store/file-store";
import { startServer } from "../server/index";

const program = new Command();

program
  .name("token-vault")
  .description(
    "Local-first design token studio — tokens live as files in your repo."
  );

const resolveDir = (dir: string) => path.resolve(process.cwd(), dir);

// Package root works from BOTH layouts: src/cli/index.ts (tsx, dev)
// and dist/cli/index.js (built) sit two levels below it. The editor
// SPA is always the Vite build at <root>/dist/app.
const PKG_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const APP_DIR = path.join(PKG_ROOT, "dist", "app");

function reportLoadError(err: unknown): never {
  if (err instanceof DesignSystemError) {
    console.error("✖ Invalid design system:");
    for (const issue of err.issues) {
      console.error(`  ${issue.file}: ${issue.message}`);
    }
  } else {
    console.error("✖", err instanceof Error ? err.message : String(err));
  }
  process.exit(1);
}

program
  .command("dev")
  .description("Start the local editor")
  .option("-d, --dir <dir>", "design system folder", "design-system")
  .option("-p, --port <port>", "port", "4477")
  .option("--no-open", "do not open the browser")
  .action(async (opts: { dir: string; port: string; open: boolean }) => {
    const dir = resolveDir(opts.dir);
    let store: FileStore;
    try {
      store = await FileStore.open(dir);
    } catch (err) {
      reportLoadError(err);
    }
    await store.startWatching();
    store.on("error", (err) => {
      if (err instanceof DesignSystemError) {
        console.error("✖ Design system became invalid:");
        for (const issue of err.issues) {
          console.error(`  ${issue.file}: ${issue.message}`);
        }
        console.error("  (fix the files — the editor will reload)");
      } else {
        console.error("✖", err);
      }
    });

    const port = Number(opts.port);
    await startServer(store, { port, appDir: APP_DIR });
    const url = `http://localhost:${port}`;
    console.log(`● token-vault dev — ${url}`);
    console.log(`  watching ${path.relative(process.cwd(), dir)}/`);
    if (opts.open) {
      const cmd =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "start"
            : "xdg-open";
      spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
    }
  });

program
  .command("check")
  .description("Validate the design system source files")
  .option("-d, --dir <dir>", "design system folder", "design-system")
  .action(async (opts: { dir: string }) => {
    try {
      const store = await FileStore.open(resolveDir(opts.dir));
      const snapshot = store.snapshot();
      const total = snapshot.collections.reduce(
        (n, c) => n + c.tokens.length,
        0
      );
      console.log(
        `✓ ${snapshot.collections.length} collection(s), ${total} token(s) — OK`
      );
      await store.close();
    } catch (err) {
      reportLoadError(err);
    }
  });

program
  .command("build")
  .description("Emit DTCG output (dist/tokens.json + dist/$metadata.json)")
  .option("-d, --dir <dir>", "design system folder", "design-system")
  .option("-o, --out <dir>", "output folder", "design-system/dist")
  .action(async (opts: { dir: string; out: string }) => {
    try {
      const store = await FileStore.open(resolveDir(opts.dir));
      const { writeDtcgBuild } = await import("../store/build");
      const files = await writeDtcgBuild(store.snapshot(), resolveDir(opts.out));
      for (const f of files) console.log(`✓ wrote ${f}`);
      await store.close();
    } catch (err) {
      reportLoadError(err);
    }
  });

program.parseAsync().catch((err) => {
  console.error(err);
  process.exit(1);
});
