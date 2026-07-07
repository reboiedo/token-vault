/**
 * Surface *recipes* — export the surfaces helper's rules as seed-driven
 * relative-color expressions instead of baked per-surface hex.
 *
 * Each surface level (fg, fg-muted, border, hover, …) is authored as a
 * rule *relative to the surface's own base*. `expressLevelRulesGeneric`
 * (surfaces-utils) already turns those rules into CSS relative-color
 * expressions driven by two seed variables:
 *
 *   --surface   the swappable seed (the background you're theming)
 *   --ink       the contrasting ink levels mix toward
 *
 * so a consumer sets `--surface`/`--ink` per scope and every level
 * recolors automatically — no per-surface tokens needed. This module
 * packages those expressions into two artifacts:
 *
 *   · a CSS `:root { --<level>: <expr> }` layer          (recipesToCss)
 *   · a DTCG `surface-recipe` token group ($value = expr) (recipesToDtcgGroup)
 *
 * Limits (documented, by design):
 *   · APCA (contrast-target) levels have no closed CSS form — they ship
 *     an *approximate* color-mix (∝ Lc), flagged `approx`. The baked
 *     per-surface tokens remain the contrast-exact source.
 *   · surface-shift freezes its polarity direction/ΔL at build time
 *     (headroom isn't expressible in CSS); the base color still cascades.
 */

import type { CollectionDoc } from "./types";
import {
  expressLevelRulesGeneric,
  type SerializedRule,
  type SurfacesConfig,
} from "./surfaces-utils";

/** Seed variable names the recipes are written against. */
export const SURFACE_SEED_VAR = "--surface";
export const INK_SEED_VAR = "--ink";

export interface SurfaceRecipe {
  /** Normalized owning-collection name (for namespacing when >1 surfaces collection). */
  collection: string;
  /** Level name, e.g. "fg-muted". */
  level: string;
  /** Single expression when both polarity branches are identical. */
  css?: string;
  /** Split expressions when the onLight / onDark branches differ. */
  onLight?: string;
  onDark?: string;
  /** True for APCA fg targets — dynamic but NOT contrast-exact. */
  approx: boolean;
  rule: SerializedRule;
}

/** DTCG-key / CSS-var safe form of a name. */
function safeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function isApprox(rule: SerializedRule): boolean {
  return rule.kind === "fg" && rule.target.kind === "apca";
}

/**
 * Build the seed-driven recipes for every collection that carries a
 * `surfacesConfig`. Reuses `expressLevelRulesGeneric`; anchor/alias
 * references inside a rule resolve to their DTCG dotted path so the
 * emitted `var(--…)` matches the exported token names.
 */
export function buildSurfaceRecipes(collections: CollectionDoc[]): SurfaceRecipe[] {
  // token name → DTCG dotted path (mirrors dtcg-export's buildTokenPathMap).
  const pathMap = new Map<string, string>();
  for (const c of collections) {
    const cp = safeName(c.name);
    for (const t of c.tokens) pathMap.set(t.name, `${cp}.${t.name}`);
  }
  const aliasName = (ref: string): string | null => pathMap.get(ref) ?? null;

  const recipes: SurfaceRecipe[] = [];
  for (const c of collections) {
    if (!c.surfacesConfig) continue;
    const collection = safeName(c.name);
    const entries = expressLevelRulesGeneric(c.surfacesConfig as SurfacesConfig, {
      surfaceVar: SURFACE_SEED_VAR,
      fgVar: INK_SEED_VAR,
      aliasName,
    });
    for (const [level, entry] of Object.entries(entries)) {
      const approx = isApprox(entry.rule);
      if ("css" in entry) {
        recipes.push({ collection, level, css: entry.css, approx, rule: entry.rule });
      } else {
        recipes.push({
          collection,
          level,
          onLight: entry.onLightSurface,
          onDark: entry.onDarkSurface,
          approx,
          rule: entry.rule,
        });
      }
    }
  }
  return recipes;
}

/** Whether recipes span more than one surfaces collection (→ namespace). */
function isMulti(recipes: SurfaceRecipe[]): boolean {
  return new Set(recipes.map((r) => r.collection)).size > 1;
}

/**
 * Emit the recipes as a CSS custom-property layer. Consumers set
 * `--surface` / `--ink` per scope; every level below follows.
 */
export function recipesToCss(recipes: SurfaceRecipe[]): string {
  if (recipes.length === 0) return "";
  const multi = isMulti(recipes);
  const out: string[] = [
    "/* Surface recipes — seed-driven relative colors.",
    " * Set --surface (the seed) and --ink (the contrasting ink) per scope;",
    " * every level recolors automatically. Levels tagged approx are NOT",
    " * contrast-exact — use the baked per-surface tokens where the exact",
    " * APCA contrast matters.",
    " */",
    ":root {",
  ];
  for (const r of recipes) {
    const base = `--${multi ? `${r.collection}-` : ""}${safeName(r.level)}`;
    const tag = r.approx ? " /* approx */" : "";
    if (r.css !== undefined) {
      out.push(`  ${base}: ${r.css};${tag}`);
    } else {
      out.push(`  ${base}-on-light: ${r.onLight};${tag}`);
      out.push(`  ${base}-on-dark: ${r.onDark};${tag}`);
    }
  }
  out.push("}");
  return out.join("\n");
}

/** Place a leaf object at a dotted path inside a nested group. */
function placeByDots(
  group: Record<string, unknown>,
  path: string,
  leaf: Record<string, unknown>
): void {
  const parts = path.split(".");
  let cur = group;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (!(k in cur)) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = leaf;
}

/**
 * Emit the recipes as a DTCG token group (one `$type: color` token per
 * level whose `$value` is the relative expression). Split-polarity
 * levels become `<level>.on-light` / `<level>.on-dark`. The serialized
 * rule + `approx` flag ride under `$extensions`.
 */
export function recipesToDtcgGroup(recipes: SurfaceRecipe[]): Record<string, unknown> {
  const group: Record<string, unknown> = {};
  const multi = isMulti(recipes);
  for (const r of recipes) {
    const ns = multi ? `${r.collection}.${safeName(r.level)}` : safeName(r.level);
    const ext = {
      "com.designsystembuilder": {
        surfaceRecipe: { rule: r.rule, ...(r.approx ? { approx: true } : {}) },
      },
    };
    if (r.css !== undefined) {
      placeByDots(group, ns, { $type: "color", $value: r.css, $extensions: ext });
    } else {
      placeByDots(group, `${ns}.on-light`, { $type: "color", $value: r.onLight, $extensions: ext });
      placeByDots(group, `${ns}.on-dark`, { $type: "color", $value: r.onDark, $extensions: ext });
    }
  }
  return group;
}
