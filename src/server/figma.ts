/**
 * Figma plugin endpoints — the local equivalent of the cloud's
 * `/api/tokens` + `/api/sync-figma-ids` Convex HTTP actions, so the
 * Token Vault Figma plugin can point at `http://localhost:4477`
 * instead of a cloud API key.
 *
 * Contract notes (mirrors web/convex/http.ts):
 *   · ids are token/collection NAMES (names are identity here) — the
 *     plugin treats them as opaque strings, and the FileStore cascades
 *     renames into the .figma-ids.json sidecar so links survive.
 *   · token names swap "." for "/" (Figma's grouping separator).
 *   · expressions / tailwind / derived values are pre-baked to raw so
 *     the plugin only ever sees raw / alias / composite.
 *   · a missing mode key is materialized from the first mode — the
 *     plugin never needs inheritance rules.
 *   · layered composites (shadow / gradient) and other non-typography
 *     composites are skipped: Figma variables can't represent them.
 */

import type { Hono } from "hono";
import { buildResolver } from "../core/resolve";
import { resolveExpressionToNumber } from "../core/expression";
import { getTailwindHex } from "../core/tailwind-colors";
import { getTailwindUtility } from "../core/tailwind-theme";
import type {
  CollectionDoc,
  SystemDoc,
  TokenDoc,
  TokenValue,
} from "../core/types";
import type { FileStore } from "../store/file-store";

type PluginValue =
  | { type: "raw"; value: string | number | boolean }
  | { type: "alias"; tokenId: string }
  | {
      type: "composite";
      value: Record<
        string,
        { type: "raw"; value: string | number | boolean } | { type: "alias"; tokenId: string }
      >;
    };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function collectionKind(
  c: CollectionDoc
): "regular" | "color" | "spacing" | "typography" {
  const types = new Set((c.generators ?? []).map((g) => g.type));
  if (types.size === 1) {
    const t = [...types][0];
    if (t === "color" || t === "spacing" || t === "typography") return t;
  }
  return "regular";
}

function coerceRawToPx(value: string | number | boolean): number | null {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (s.endsWith("px")) {
    const n = Number(s.slice(0, -2));
    return Number.isFinite(n) ? n : null;
  }
  if (s.endsWith("rem")) {
    const n = Number(s.slice(0, -3));
    return Number.isFinite(n) ? n * 16 : null;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Composite tokens the plugin understands (text styles). */
function isPluginComposite(t: TokenDoc, v: TokenValue): boolean {
  return (
    v.type === "composite" && !Array.isArray(v.layers) && t.type === "typography"
  );
}

export function buildFigmaTokensPayload(
  system: SystemDoc,
  collections: CollectionDoc[],
  ids: {
    collections: Record<string, { figmaId?: string; figmaFluidId?: string }>;
    tokens: Record<string, { figmaId?: string; figmaTextStyleId?: string }>;
  }
) {
  const resolver = buildResolver(collections);

  // Recursive px resolver for expression baking: expressions may chain
  // through aliases and other expression tokens (cycle-guarded).
  const tokensByName = new Map<string, { token: TokenDoc; modes: string[] }>();
  for (const c of collections)
    for (const t of c.tokens) tokensByName.set(t.name, { token: t, modes: c.modes });

  const resolvePx = (
    name: string,
    mode: string,
    visiting: Set<string>
  ): number | null => {
    if (visiting.has(name)) return null;
    visiting.add(name);
    try {
      const entry = tokensByName.get(name);
      if (!entry) return null;
      const { token, modes } = entry;
      if (typeof token.maxPx === "number") return token.maxPx;
      const v = token.values[mode] ?? token.values[modes[0]];
      if (!v) return null;
      if (v.type === "raw") return coerceRawToPx(v.value);
      if (v.type === "alias") return resolvePx(v.token, mode, visiting);
      if (v.type === "expression") {
        return resolveExpressionToNumber(v.formula, (ref) =>
          resolvePx(ref, mode, visiting)
        );
      }
      return null;
    } finally {
      visiting.delete(name);
    }
  };

  const pluginValue = (
    token: TokenDoc,
    value: TokenValue,
    mode: string
  ): PluginValue | null => {
    switch (value.type) {
      case "raw":
        return { type: "raw", value: value.value };
      case "alias":
        return { type: "alias", tokenId: value.token };
      case "tailwind":
      case "derived": {
        const resolved = resolver.resolveRaw(token.name, mode);
        return resolved === null ? null : { type: "raw", value: resolved };
      }
      case "expression": {
        // Pre-bake to px like the cloud endpoint — the plugin has no
        // expression evaluator.
        const px = resolvePx(token.name, mode, new Set());
        return { type: "raw", value: px ?? 0 };
      }
      case "composite": {
        if (!isPluginComposite(token, value)) return null;
        const layer = value.layers as Record<
          string,
          | { type: "raw"; value: string | number | boolean }
          | { type: "alias"; token: string }
          | { type: "tailwind"; color: string }
        >;
        const slots: Record<
          string,
          { type: "raw"; value: string | number | boolean } | { type: "alias"; tokenId: string }
        > = {};
        for (const [slot, sv] of Object.entries(layer)) {
          if (sv.type === "alias") {
            slots[slot] = { type: "alias", tokenId: sv.token };
          } else if (sv.type === "tailwind") {
            // Figma variables can't hold a Tailwind ref — pre-bake to raw.
            const resolved = getTailwindHex(sv.color) ?? getTailwindUtility(sv.color)?.value ?? "";
            slots[slot] = { type: "raw", value: resolved };
          } else {
            slots[slot] = { type: "raw", value: sv.value };
          }
        }
        return { type: "composite", value: slots };
      }
      default:
        return null;
    }
  };

  const tokens: unknown[] = [];
  for (const c of collections) {
    const baseMode = c.modes[0];
    c.tokens.forEach((t, index) => {
      // Skip token types Figma variables can't hold.
      const sample = t.values[baseMode] ?? Object.values(t.values)[0];
      if (!sample) return;
      if (sample.type === "composite" && !isPluginComposite(t, sample)) return;

      const values: Record<string, PluginValue> = {};
      for (const mode of c.modes) {
        const v = t.values[mode] ?? t.values[baseMode];
        if (!v) continue;
        const pv = pluginValue(t, v, mode);
        if (pv) values[mode] = pv;
      }
      if (Object.keys(values).length === 0) return;

      const linked = ids.tokens[t.name] ?? {};
      tokens.push({
        _id: t.name,
        collectionId: c.name,
        name: t.name.replace(/\./g, "/"),
        type: t.type,
        values,
        figmaVariableId: linked.figmaId,
        figmaTextStyleId: linked.figmaTextStyleId,
        minPx: t.minPx,
        maxPx: t.maxPx,
        sortOrder: index,
      });
    });
  }

  const spacingBase = (c: CollectionDoc) => {
    const gen = (c.generators ?? []).find((g) => g.type === "spacing");
    if (gen?.config.type !== "spacing") return null;
    return gen.config.spacingConfig;
  };

  return {
    designSystem: {
      _id: system.name,
      name: system.name,
      description: system.description,
      fluidSettings: {
        viewport: system.fluid.viewport,
        breakpoints: system.fluid.breakpoints,
      },
    },
    collections: collections.map((c, index) => {
      const linked = ids.collections[c.name] ?? {};
      const spacing = spacingBase(c);
      const hasFluid = (c.generators ?? []).some(
        (g) => g.type === "spacing" || g.type === "typography"
      );
      return {
        _id: c.name,
        name: c.name,
        kind: collectionKind(c),
        modes: c.modes,
        sortOrder: index,
        figmaCollectionId: linked.figmaId,
        figmaFluidCollectionId: linked.figmaFluidId,
        ...(hasFluid
          ? {
              spacingScaleConfig: {
                viewport: {
                  ...system.fluid.viewport,
                  minFontSize: spacing?.baseMin ?? 18,
                  maxFontSize: spacing?.baseMax ?? 20,
                },
                breakpoints: system.fluid.breakpoints,
              },
            }
          : {}),
      };
    }),
    tokens,
  };
}

export function registerFigmaRoutes(app: Hono, store: FileStore): void {
  app.options("/api/figma/*", (c) => c.body(null, 204, CORS));

  app.get("/api/figma/tokens", async (c) => {
    const { system, collections } = store.snapshot();
    const ids = await store.readFigmaIds();
    return c.json(buildFigmaTokensPayload(system, collections, ids), 200, CORS);
  });

  app.post("/api/figma/sync-ids", async (c) => {
    const body = (await c.req.json()) as {
      collections?: Array<{ convexId: string; figmaId?: string; figmaFluidId?: string }>;
      tokens?: Array<{ convexId: string; figmaId?: string; figmaTextStyleId?: string }>;
    };
    try {
      await store.updateFigmaIds({
        collections: (body.collections ?? []).map((x) => ({
          name: x.convexId,
          figmaId: x.figmaId,
          figmaFluidId: x.figmaFluidId,
        })),
        tokens: (body.tokens ?? []).map((x) => ({
          name: x.convexId,
          figmaId: x.figmaId,
          figmaTextStyleId: x.figmaTextStyleId,
        })),
      });
      return c.json({ ok: true }, 200, CORS);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : String(err) },
        422,
        CORS
      );
    }
  });
}
