#!/usr/bin/env node
/**
 * token-vault CLI.
 *
 *   token-vault dev    — run the local editor on your design-system/ folder
 *   token-vault build  — emit dist/tokens.json + dist/$metadata.json (DTCG)
 *   token-vault check  — validate the source files (CI-friendly)
 *   token-vault init   — scaffold a design-system/ folder   (F3)
 *   token-vault mcp    — MCP stdio server over the files     (F4)
 *   token-vault figma  — print the bundled Figma plugin's manifest path
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

const DEFAULT_PORT = 4477;

program
  .command("dev")
  .description("Start the local editor")
  .option("-d, --dir <dir>", "design system folder", "design-system")
  .option(
    "-p, --port <port>",
    `port (default: system.json devPort, else ${DEFAULT_PORT})`
  )
  .option("--no-open", "do not open the browser")
  .action(async (opts: { dir: string; port?: string; open: boolean }) => {
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

    // Port precedence: explicit --port flag > system.json devPort > default.
    const devPort = store.snapshot().system.devPort;
    const [port, portSource] =
      opts.port !== undefined
        ? [Number(opts.port), "--port"]
        : devPort !== undefined
          ? [devPort, "system.json devPort"]
          : [DEFAULT_PORT, "default"];
    await startServer(store, { port, appDir: APP_DIR });
    const url = `http://localhost:${port}`;
    console.log(`● token-vault dev — ${url} (port from ${portSource})`);
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
  .command("init")
  .description("Scaffold a design-system/ folder in the current repo")
  .option("-d, --dir <dir>", "target folder", "design-system")
  .option("-n, --name <name>", "design system name")
  .action(async (opts: { dir: string; name?: string }) => {
    const fs = await import("node:fs/promises");
    const dir = resolveDir(opts.dir);
    try {
      await fs.access(dir);
      console.error(`✖ ${opts.dir}/ already exists — aborting.`);
      process.exit(1);
    } catch {
      // Doesn't exist — good.
    }
    const template = path.join(PKG_ROOT, "templates", "design-system");
    await fs.cp(template, dir, { recursive: true });
    const name = opts.name ?? path.basename(process.cwd());
    const systemFile = path.join(dir, "system.json");
    const system = (await fs.readFile(systemFile, "utf8")).replace(
      "__NAME__",
      name
    );
    await fs.writeFile(systemFile, system);
    console.log(`✓ created ${opts.dir}/ ("${name}")`);
    console.log(`  next: npx token-vault-studio dev -d ${opts.dir}`);
    console.log(
      `  AI agents: ${opts.dir}/AGENTS.md has the editing rules; ` +
        `run \`npx token-vault-studio mcp -d ${opts.dir}\` for the MCP server.`
    );
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
      const dangling = store.findDanglingRefs();
      for (const d of dangling) {
        console.error(`✖ ${d.owner}: unresolvable reference "${d.ref}"`);
      }
      if (dangling.length) process.exit(1);
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

program
  .command("figma")
  .description("Print the bundled Figma plugin's manifest path + install steps")
  .option("-d, --dir <dir>", "design system folder (to read devPort)", "design-system")
  .action(async (opts: { dir: string }) => {
    const manifest = path.join(PKG_ROOT, "dist", "figma-plugin", "manifest.json");
    const { existsSync } = await import("node:fs");
    if (!existsSync(manifest)) {
      console.error("✖ Figma plugin not found in this install (expected at");
      console.error(`  ${manifest})`);
      console.error("  Reinstall token-vault-studio, or run `pnpm build:plugin` in a source checkout.");
      process.exit(1);
    }
    // This project's dev-server URL: system.json devPort if set (raw JSON
    // read — the plugin URL should print even if the system fails checks).
    let port = DEFAULT_PORT;
    let portNote = "";
    try {
      const fs = await import("node:fs/promises");
      const raw = JSON.parse(
        await fs.readFile(path.join(resolveDir(opts.dir), "system.json"), "utf8")
      ) as { devPort?: number };
      if (typeof raw.devPort === "number") {
        port = raw.devPort;
        portNote = " (from system.json devPort)";
      }
    } catch {
      // No design system here — the default-port instructions still hold.
    }
    const url = `http://localhost:${port}`;
    console.log(manifest);
    console.log("");
    console.log("Install (once, Figma desktop):");
    console.log("  Figma → Plugins → Development → Import plugin from manifest… → pick the path above");
    console.log("Use:");
    console.log(`  1. npx token-vault-studio dev       (this project's server: ${url}${portNote})`);
    console.log(`  2. Run the Token Vault plugin in Figma and enter ${url}`);
    console.log("");
    console.log("Working on several projects? Give each its own devPort in system.json");
    console.log("(the plugin allows http://localhost:4470–4479) — the plugin remembers");
    console.log("the URL per Figma file, so projects stay isolated.");
  });

program
  .command("mcp")
  .description("Run the MCP stdio server over the design system files")
  .option("-d, --dir <dir>", "design system folder", "design-system")
  .action(async (opts: { dir: string }) => {
    const { startMcpServer } = await import("../mcp/index");
    try {
      await startMcpServer(resolveDir(opts.dir));
    } catch (err) {
      reportLoadError(err);
    }
  });

program.parseAsync().catch((err) => {
  console.error(err);
  process.exit(1);
});
