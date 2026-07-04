/**
 * token-vault MCP server — stdio, no API keys, no rate limits.
 *
 * Operates directly on the design-system/ folder through an in-process
 * FileStore. If `token-vault dev` is running, its chokidar watcher
 * reconciles our writes the same way it absorbs human edits — the MCP
 * never needs to talk to the dev server. The store here watches the
 * folder too, so external changes stay visible between tool calls.
 *
 * Tool set mirrors the cloud MCP minus checkpoints (git covers those)
 * and the suggest_* prompts (the calling agent IS the LLM).
 * Token values accept the FILE encoding — the same shapes documented
 * in collections/*.json ("{alias}", {"$tw"}, {"$derive"}, {"$expr"},
 * {"$composite"}) — so agents can copy what they read in the repo.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { FileStore } from "../store/file-store";
import { fileValueSchema, decodeValue, surfacesConfigSchema } from "../schema/index";
import { writeDtcgBuild } from "../store/build";
import { buildResolver } from "../core/resolve";
import { apcaLc } from "../core/apca-utils";
import type { GeneratorDef, TokenType, TokenValue } from "../core/types";
import type { SurfacesConfig } from "../core/surfaces-utils";

const TOKEN_TYPES = [
  "color", "dimension", "fontFamily", "fontWeight", "duration",
  "cubicBezier", "transition", "number", "shadow", "border",
  "typography", "gradient", "string", "boolean",
] as const;

const valuesParam = z
  .record(z.string(), fileValueSchema)
  .describe(
    'Per-mode values in the source-file encoding: plain string/number = raw, "{token.name}" = alias, {"$tw":"slate-500"}, {"$derive":{...}}, {"$expr":"a * 2"}, {"$composite":{...}}'
  );

function decodeValues(values: Record<string, unknown>): Record<string, TokenValue> {
  return Object.fromEntries(
    Object.entries(values).map(([mode, v]) => [
      mode,
      decodeValue(fileValueSchema.parse(v)),
    ])
  );
}

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

export async function startMcpServer(dir: string): Promise<void> {
  const store = await FileStore.open(dir);
  await store.startWatching();

  const server = new McpServer({
    name: "token-vault",
    version: "0.1.0",
  });

  // ==========================================================================
  // READS
  // ==========================================================================

  server.tool(
    "get_context",
    "Design system overview: system settings plus every collection with modes, generators and token counts. Start here.",
    {},
    async () => {
      const { system, collections, rev } = store.snapshot();
      return ok({
        system,
        rev,
        collections: collections.map((c) => ({
          name: c.name,
          modes: c.modes,
          generators: c.generators?.map((g) => ({
            id: g.id,
            type: g.type,
            groupPrefix: g.groupPrefix,
          })),
          hasSurfaces: !!c.surfacesConfig,
          tokenCount: c.tokens.length,
          generatedCount: c.tokens.filter((t) => t.generated).length,
        })),
      });
    }
  );

  server.tool(
    "get_tokens",
    "All tokens of one collection (source + generated), with per-mode values in canonical form.",
    { collection: z.string() },
    async ({ collection }) => {
      const c = store
        .snapshot()
        .collections.find((c) => c.name === collection);
      if (!c) throw new Error(`Unknown collection "${collection}"`);
      return ok(c.tokens);
    }
  );

  server.tool(
    "get_tokens_snapshot",
    "Compact snapshot of every token in the system: name, type, resolved value per mode. Cheapest full read.",
    {},
    async () => {
      const { system, collections } = store.snapshot();
      const resolver = buildResolver(collections);
      return ok({
        system: { name: system.name },
        tokens: collections.flatMap((c) =>
          c.tokens.map((t) => ({
            collection: c.name,
            name: t.name,
            type: t.type,
            generated: t.generated || undefined,
            resolved: Object.fromEntries(
              c.modes
                .map((m) => [m, resolver.resolveRaw(t.name, m)])
                .filter(([, v]) => v != null)
            ),
          }))
        ),
      });
    }
  );

  server.tool(
    "list_generators",
    "Every generator config and surfaces config in the system — the editable intent behind `generated: true` tokens. Modify via update_generator / update_surfaces, never by editing generated tokens.",
    {},
    async () => {
      const { collections } = store.snapshot();
      return ok(
        collections
          .filter((c) => c.generators?.length || c.surfacesConfig)
          .map((c) => ({
            collection: c.name,
            generators: c.generators,
            surfacesConfig: c.surfacesConfig,
          }))
      );
    }
  );

  server.tool(
    "export_dtcg",
    "Bake the current system to DTCG and write design-system/dist (tokens.json + $metadata.json). Returns the written file paths.",
    {},
    async () => {
      const files = await writeDtcgBuild(
        store.snapshot(),
        path.join(store.dir, "dist")
      );
      return ok({ written: files });
    }
  );

  // ==========================================================================
  // WRITES — every mutation persists to the source files immediately;
  // commit with git when a body of work is done.
  // ==========================================================================

  server.tool(
    "create_token",
    "Create a hand-authored token in a collection.",
    {
      collection: z.string(),
      name: z.string().describe("Dotted name, globally unique (identity)"),
      type: z.enum(TOKEN_TYPES).optional(),
      description: z.string().optional(),
      values: valuesParam,
    },
    async ({ collection, name, type, description, values }) => {
      await store.createToken({
        collection,
        token: {
          name,
          type: type as TokenType | undefined,
          description,
          values: decodeValues(values),
        },
      });
      return ok({ created: name });
    }
  );

  server.tool(
    "batch_create_tokens",
    "Create several tokens in one collection at once.",
    {
      collection: z.string(),
      tokens: z.array(
        z.object({
          name: z.string(),
          type: z.enum(TOKEN_TYPES).optional(),
          description: z.string().optional(),
          values: valuesParam,
        })
      ),
    },
    async ({ collection, tokens }) => {
      for (const t of tokens) {
        await store.createToken({
          collection,
          token: {
            name: t.name,
            type: t.type as TokenType | undefined,
            description: t.description,
            values: decodeValues(t.values),
          },
        });
      }
      return ok({ created: tokens.map((t) => t.name) });
    }
  );

  server.tool(
    "update_token",
    "Update a hand-authored token's values/type/description. Generated tokens are refused — edit their generator or surfaces config instead.",
    {
      name: z.string(),
      type: z.enum(TOKEN_TYPES).optional(),
      description: z.string().optional(),
      values: valuesParam.optional(),
    },
    async ({ name, type, description, values }) => {
      await store.updateToken({
        name,
        type: type as TokenType | undefined,
        description,
        values: values ? decodeValues(values) : undefined,
      });
      return ok({ updated: name });
    }
  );

  server.tool(
    "rename_token",
    "Rename a token. Every reference (aliases, derivations, expressions, composites, surfaces config) is rewritten across all files.",
    { name: z.string(), newName: z.string() },
    async ({ name, newName }) => {
      await store.renameToken({ name, newName });
      return ok({ renamed: { from: name, to: newName } });
    }
  );

  server.tool(
    "delete_token",
    "Delete a hand-authored token.",
    { name: z.string() },
    async ({ name }) => {
      await store.removeToken({ name });
      return ok({ deleted: name });
    }
  );

  server.tool(
    "create_collection",
    "Create a new (empty) collection file and register it in system.json.",
    { name: z.string(), modes: z.array(z.string()).optional() },
    async ({ name, modes }) => {
      await store.createCollection({ name, modes });
      return ok({ created: name });
    }
  );

  server.tool(
    "update_generator",
    "Replace a generator's config (color scale / spacing / typography). Generated tokens recompute immediately.",
    {
      collection: z.string(),
      generatorId: z.string(),
      config: z
        .unknown()
        .describe(
          "Full GeneratorConfig object, same shape as stored in collections/<name>.json"
        ),
    },
    async ({ collection, generatorId, config }) => {
      await store.updateGeneratorConfig({
        collection,
        generatorId,
        config: config as GeneratorDef["config"],
      });
      return ok({ updated: generatorId });
    }
  );

  server.tool(
    "update_surfaces",
    "Replace a collection's surfaces config (surfaces, levels, rules). Preserve per-mode and per-cell granularity — never collapse modes. Pass null to remove.",
    {
      collection: z.string(),
      config: surfacesConfigSchema.nullable(),
    },
    async ({ collection, config }) => {
      await store.updateSurfacesConfig({
        collection,
        config: config as SurfacesConfig | null,
      });
      return ok({ updated: collection });
    }
  );

  // ==========================================================================
  // ANALYSIS
  // ==========================================================================

  server.tool(
    "analyze_accessibility",
    "APCA contrast report for every surfaces collection: each materialized fg-ish level vs its surface base, per mode. |Lc| ≥ 60 body text, ≥ 45 large text, ≥ 30 minimum.",
    {},
    async () => {
      const { collections } = store.snapshot();
      const resolver = buildResolver(collections);
      const rows: Array<{
        collection: string;
        surface: string;
        level: string;
        mode: string;
        fg: string;
        bg: string;
        lc: number;
      }> = [];
      for (const c of collections) {
        const surfaces = c.surfacesConfig as SurfacesConfig | undefined;
        if (!surfaces) continue;
        for (const s of surfaces.surfaces) {
          for (const mode of c.modes) {
            const bg = resolver.resolveRaw(s.name, mode);
            if (!bg?.startsWith("#")) continue;
            for (const l of surfaces.levels) {
              const tokenName = s.bareLevels ? l.name : `${s.name}.${l.name}`;
              const fg = resolver.resolveRaw(tokenName, mode);
              if (!fg?.startsWith("#") || l.rule.kind !== "fg") continue;
              rows.push({
                collection: c.name,
                surface: s.name,
                level: l.name,
                mode,
                fg,
                bg,
                lc: Math.round(Math.abs(apcaLc(fg, bg)) * 10) / 10,
              });
            }
          }
        }
      }
      return ok({ pairs: rows });
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`token-vault mcp — watching ${dir}`);
}
