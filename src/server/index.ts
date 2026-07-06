/**
 * Local dev server: serves the editor SPA, exposes the snapshot over
 * REST + WebSocket, and (from F2) accepts mutations.
 *
 *   GET  /api/snapshot   → SystemSnapshot (JSON)
 *   WS   /ws             → { type: "snapshot", rev, data } on connect
 *                          and on every store change
 *   GET  /*              → static editor app (dist/app)
 */

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { WebSocketServer, WebSocket } from "ws";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FileStore } from "../store/file-store";
import { registerFigmaRoutes } from "./figma";

export interface ServerOptions {
  port: number;
  /** Absolute path to the built SPA (dist/app). */
  appDir?: string;
}

export async function startServer(store: FileStore, opts: ServerOptions) {
  const app = new Hono();

  app.get("/api/snapshot", (c) => c.json(store.snapshot()));

  app.get("/api/health", (c) =>
    c.json({ ok: true, rev: store.snapshot().rev })
  );

  // Figma plugin endpoints (see server/figma.ts) — CORS-open because the
  // plugin UI runs in Figma's sandboxed iframe (null origin).
  registerFigmaRoutes(app, store);

  // Mutation RPC. Methods map 1:1 to FileStore mutation methods; the
  // response is the fresh snapshot so the caller can apply it without
  // waiting for the WS broadcast.
  const MUTATIONS = [
    "createToken",
    "updateToken",
    "removeToken",
    "renameToken",
    "renameGroup",
    "reorderTokens",
    "addMode",
    "renameMode",
    "removeMode",
    "reorderModes",
    "updateGroupOrder",
    "addGenerator",
    "updateGeneratorConfig",
    "removeGenerator",
    "updateSurfacesConfig",
    "updateCollectionTailwind",
    "createCollection",
    "removeCollection",
    "renameCollection",
    "updateSystem",
  ] as const;
  type MutationMethod = (typeof MUTATIONS)[number];

  app.post("/api/rpc", async (c) => {
    const body = (await c.req.json()) as {
      method: MutationMethod;
      params: unknown;
    };
    if (!MUTATIONS.includes(body.method)) {
      return c.json({ error: `Unknown method "${body.method}"` }, 400);
    }
    try {
      await (
        store[body.method] as (p: unknown) => Promise<void>
      )(body.params);
      return c.json({ ok: true, snapshot: store.snapshot() });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : String(err) },
        422
      );
    }
  });

  const appDir =
    opts.appDir ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../app");
  app.use(
    "/*",
    serveStatic({
      root: path.relative(process.cwd(), appDir),
      rewriteRequestPath: (p) => (p === "/" ? "/index.html" : p),
    })
  );
  // SPA fallback: client-routed paths (/generators/:id, /surfaces/:c)
  // must survive a hard reload.
  app.get("*", async (c) => {
    const html = await import("node:fs/promises").then((fs) =>
      fs.readFile(path.join(appDir, "index.html"), "utf8")
    );
    return c.html(html);
  });

  const server = serve({ fetch: app.fetch, port: opts.port });

  // WebSocket: push the full snapshot on connect and on every change.
  const wss = new WebSocketServer({ noServer: true });
  server.addListener("upgrade", (req, socket, head) => {
    if (req.url === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  const send = (ws: WebSocket) => {
    const snapshot = store.snapshot();
    ws.send(
      JSON.stringify({ type: "snapshot", rev: snapshot.rev, data: snapshot })
    );
  };
  wss.on("connection", (ws) => send(ws));
  store.on("change", () => {
    for (const ws of wss.clients) {
      if (ws.readyState === WebSocket.OPEN) send(ws);
    }
  });
  store.on("error", (err) => {
    for (const ws of wss.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({ type: "error", message: String(err?.message ?? err) })
        );
      }
    }
  });

  return {
    close: async () => {
      wss.close();
      server.close();
      await store.close();
    },
  };
}
