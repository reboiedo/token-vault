/**
 * DTCG Export Utility
 *
 * Generates Design Tokens Community Group compliant JSON files:
 * - tokens.json: The actual token values in DTCG format
 * - $metadata.json: Generator configs, surfaces configs, webapp settings
 *
 * Port of the cloud product's web/src/lib/dtcg-export.ts with
 * name-based identity: tokens are referenced by dotted name, paths are
 * derived directly from `normalizedCollectionName + "." + token.name`,
 * and expressions/derivations resolve identifiers by name. Consumes the
 * canonical documents from core/types (collections own their tokens —
 * callers pass collections already recomputed, i.e. with `generated`
 * tokens materialized).
 *
 * This enables:
 * - LLMs to understand how tokens were generated and modify configs
 * - Bidirectional sync (import tokens back into the editor)
 * - Style Dictionary compatibility
 */

import { hexToOklch } from "./color-utils";
import { getTailwindColor } from "./tailwind-colors";
import { getTailwindUtility } from "./tailwind-theme";
import { buildSurfaceRecipes, recipesToDtcgGroup } from "./surface-recipe";
import { resolveDerivationToHex, emitCssRelativeColor } from "./derivation";
import {
  parseExpression,
  emitCssExpression,
  resolveExpressionToNumber,
} from "./expression";
import {
  expressLevelRulesGeneric,
  type SurfacesConfig,
} from "./surfaces-utils";
import type {
  CollectionDoc,
  CompositeLayer,
  SystemDoc,
  TokenDoc,
  TokenRef,
  TokenValue,
} from "./types";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Collection "kind" — the cloud schema stored this explicitly; in
 * token-vault it is derived from what the collection contains (surfaces
 * config and/or generators). Drives $description text, default token
 * types and the metadata `kind` field.
 */
export type CollectionKind =
  | "regular"
  | "color"
  | "fluid"
  | "spacing"
  | "typography"
  | "themes";

/**
 * Identity + freshness block embedded in `$metadata.json`. Clients read
 * this to discover the export layout and the file list.
 */
export interface DtcgMetaBlock {
  name: string;
  exportLayout: "single" | "per-collection";
  files: string[];
  generatedAt: string;
}

// Metadata file structure
export interface DtcgMetadata {
  $schema: string;
  version: string;
  generatedAt: string;
  /** Identity + freshness block. See `DtcgMetaBlock`. */
  $meta?: DtcgMetaBlock;
  designSystem: {
    name: string;
    description?: string;
  };
  modes: string[];
  collections: Record<string, CollectionMetadata>;
}

export interface CollectionMetadata {
  kind: CollectionKind;
  modes: string[];
  generators?: Array<{
    id: string;
    type: "color" | "spacing" | "typography";
    groupPrefix: string;
    generator: ColorScaleGeneratorMeta | FluidScaleGeneratorMeta;
  }>;
  /**
   * Surfaces/themes helper config, emitted verbatim (it is JSON-safe
   * and name-based). The cloud product never serialized this — a known
   * gap; in token-vault the config travels with the export so a clone
   * can rebuild the helper state.
   */
  surfacesConfig?: SurfacesConfig;
}

export interface ColorScaleGeneratorMeta {
  type: "colorScale";
  steps: string[];
  families: Array<{
    name: string;
    lightness: ChannelConfigMeta;
    chroma: ChannelConfigMeta;
    hue: ChannelConfigMeta;
  }>;
  syncedChannels?: {
    lightness?: boolean;
    chroma?: boolean;
    hue?: boolean;
  };
}

// Spline handle for bezier curve control
export interface SplineHandleMeta {
  x: number;
  y: number;
}

// Override value can be simple number or full spline point
export interface SplineOverrideMeta {
  value: number;
  handleIn?: SplineHandleMeta;
  handleOut?: SplineHandleMeta;
}

export interface ChannelConfigMeta {
  start: number;
  end: number;
  curve: string;
  customBezier?: number[];
  // Per-step overrides with optional bezier handles for fine-tuned curves
  overrides?: Record<string, number | SplineOverrideMeta>;
}

export interface FluidScaleGeneratorMeta {
  type: "fluidScale";
  viewport: {
    minWidth: number;
    maxWidth: number;
  };
  breakpoints?: number[];
  spacing?: {
    baseMin: number;
    baseMax: number;
    steps: Array<{ name: string; multiplier: number }>;
    fixedSteps?: Array<{ value: number }>;
    includePairs: boolean;
    customPairs: Array<{ from: string; to: string }>;
    unit: "rem" | "px";
    prefix: string;
  };
  typography?: {
    steps: Array<{ minPx: number; maxPx: number }>;
    unit: "rem" | "px";
    prefix: string;
    baseStepIndex?: number;
  };
}

export interface DtcgExportResult {
  /** Combined single-file output (always present, used when layout === "single"). */
  tokens: Record<string, unknown>;
  metadata: DtcgMetadata;
  /**
   * Per-collection file map (filename without extension → tokens content).
   * Only populated when layout === "per-collection". Filenames are
   * `normalizeCollectionName(collection.name)`, suitable for `<name>.json`.
   */
  tokenFiles?: Record<string, Record<string, unknown>>;
}

export type ExportLayout = "single" | "per-collection";

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Normalize collection name for use as JSON key
 */
export function normalizeCollectionName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/**
 * Build a map of token refs (dotted names) to their DTCG paths for
 * alias resolution. The path is the token's name with the normalized
 * name of its owning collection prepended. Full paths also resolve to
 * themselves (secondary keys) so refs that already carry the collection
 * prefix serialize correctly.
 */
function buildTokenPathMap(collections: CollectionDoc[]): Map<string, string> {
  const pathMap = new Map<string, string>();

  for (const collection of collections) {
    const collectionPath = normalizeCollectionName(collection.name);
    for (const token of collection.tokens) {
      pathMap.set(token.name, `${collectionPath}.${token.name}`);
    }
  }
  // Secondary keys: full path → itself, without clobbering names.
  for (const path of Array.from(pathMap.values())) {
    if (!pathMap.has(path)) pathMap.set(path, path);
  }

  return pathMap;
}

/**
 * Derive the effective kind for a collection. The cloud schema stored
 * `kind` explicitly; here it falls out of the collection's contents:
 * a surfaces config marks a themes collection, otherwise the generator
 * types decide (mixed fluid generators → "fluid").
 */
function getEffectiveKind(collection: CollectionDoc): CollectionKind {
  if (collection.surfacesConfig) return "themes";
  const generators = collection.generators ?? [];
  if (generators.length > 0) {
    const types = new Set(generators.map((g) => g.type));
    if (types.size === 1) {
      const only = generators[0].type;
      if (only === "color") return "color";
      if (only === "spacing") return "spacing";
      return "typography";
    }
    if (!types.has("color")) return "fluid";
  }
  return "regular";
}

/**
 * Get the effective DTCG type for a token
 */
function getEffectiveType(collection: CollectionDoc, token: TokenDoc): string {
  if (token.type) return token.type;
  const kind = getEffectiveKind(collection);
  if (kind === "color" || kind === "themes") return "color";
  if (kind === "fluid" || kind === "spacing" || kind === "typography") {
    return "dimension";
  }
  return "string";
}

/**
 * Recursively sort object keys for consistent JSON output
 */
export function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }
  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  for (const key of keys) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * Check if a string is a valid hex color
 */
function isHexColor(value: string): boolean {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(value);
}

/**
 * Convert hex color to OKLCH CSS format
 * Returns format: "oklch(0.65 0.15 250)"
 * Handles achromatic colors (grays) where hue is undefined/NaN
 */
function hexToOklchString(hex: string): string {
  const { l, c, h } = hexToOklch(hex);
  // Round to reasonable precision
  const lRounded = Math.round(l * 1000) / 1000;
  const cRounded = Math.round(c * 1000) / 1000;
  // Handle NaN hue for achromatic colors (grays, white, black)
  const hRounded = Number.isNaN(h) ? 0 : Math.round(h * 10) / 10;
  // Preserve a true-alpha channel from 8-digit hex (`#rrggbbaa`).
  const clean = hex.replace(/^#/, "");
  if (clean.length === 8) {
    const a = parseInt(clean.slice(6, 8), 16) / 255;
    if (a < 1) {
      const aRounded = Math.round(a * 1000) / 1000;
      return `oklch(${lRounded} ${cRounded} ${hRounded} / ${aRounded})`;
    }
  }
  return `oklch(${lRounded} ${cRounded} ${hRounded})`;
}

// =============================================================================
// GENERATOR METADATA EXTRACTION
// =============================================================================

/**
 * Extract channel config metadata including overrides with handles
 */
function extractChannelConfigMeta(channel: {
  start: number;
  end: number;
  curve: string;
  customBezier?: readonly number[];
  overrides?: Record<
    string,
    | number
    | {
        value: number;
        handleIn?: { x: number; y: number };
        handleOut?: { x: number; y: number };
      }
  >;
}): ChannelConfigMeta {
  const meta: ChannelConfigMeta = {
    start: channel.start,
    end: channel.end,
    curve: channel.curve,
    customBezier: channel.customBezier ? [...channel.customBezier] : undefined,
  };

  // Include overrides if present
  if (channel.overrides && Object.keys(channel.overrides).length > 0) {
    meta.overrides = {};
    for (const [step, override] of Object.entries(channel.overrides)) {
      if (typeof override === "number") {
        meta.overrides[step] = override;
      } else {
        // Full spline override with handles
        const splineOverride: SplineOverrideMeta = {
          value: override.value,
        };
        if (override.handleIn) {
          splineOverride.handleIn = {
            x: override.handleIn.x,
            y: override.handleIn.y,
          };
        }
        if (override.handleOut) {
          splineOverride.handleOut = {
            x: override.handleOut.x,
            y: override.handleOut.y,
          };
        }
        meta.overrides[step] = splineOverride;
      }
    }
  }

  return meta;
}

// =============================================================================
// TOKEN VALUE HELPERS
// =============================================================================

/**
 * Resolution context built once per export call. Walks alias and derived
 * references with memoization so each token's hex is computed at most
 * once. Cycle detection runs at write time; the `visiting` set guards
 * against bugs that might slip past it.
 */
interface ResolveCtx {
  tokenHexByRef: (ref: TokenRef) => string | null;
  cssVarFor: (ref: TokenRef) => string | null;
  /**
   * Per-mode alias resolver — walks the alias / derived / tailwind
   * chain for a specific target mode.
   */
  resolveHexAtMode: (ref: TokenRef, mode: string) => string | null;
  /**
   * Numeric (pixel) resolver — walks raw / alias / expression. Used by
   * expression token resolution to look up referenced tokens. Fluid
   * tokens fall back to `maxPx`. The `mode` argument is explicit so a
   * multi-mode export emits each mode's correct lookup, instead of
   * collapsing to the export's outer mode.
   */
  tokenPxByRef: (ref: TokenRef, mode: string) => number | null;
}

function buildResolveCtx(
  collections: CollectionDoc[],
  pathMap: Map<string, string>,
  mode: string
): ResolveCtx {
  // Primary lookup is by token name; refs that carry the normalized
  // collection prefix (full DTCG paths) resolve via secondary keys.
  const tokensByRef = new Map<string, TokenDoc>();
  for (const collection of collections) {
    const collectionPath = normalizeCollectionName(collection.name);
    for (const t of collection.tokens) {
      tokensByRef.set(t.name, t);
      const path = `${collectionPath}.${t.name}`;
      if (!tokensByRef.has(path)) tokensByRef.set(path, t);
    }
  }

  const resolveHexAtMode = (
    ref: TokenRef,
    m: string,
    seen = new Set<string>()
  ): string | null => {
    if (seen.has(ref)) return null;
    seen.add(ref);
    const tk = tokensByRef.get(ref);
    if (!tk) return null;
    const v = tk.values[m] ?? Object.values(tk.values)[0];
    if (!v) return null;
    if (v.type === "raw" && typeof v.value === "string") return v.value;
    if (v.type === "alias") {
      return resolveHexAtMode(v.token, m, seen);
    }
    if (v.type === "tailwind") {
      const tw = getTailwindColor(v.color);
      return tw?.hex ?? null;
    }
    if (v.type === "derived") {
      return resolveDerivationToHex(v.base, v.ops, (ref2) =>
        resolveHexAtMode(ref2, m, seen)
      );
    }
    return null;
  };

  const cache = new Map<string, string | null>();
  const visiting = new Set<string>();

  const tokenHexByRef = (ref: TokenRef): string | null => {
    if (cache.has(ref)) return cache.get(ref) ?? null;
    if (visiting.has(ref)) return null;
    visiting.add(ref);
    const token = tokensByRef.get(ref);
    let hex: string | null = null;
    if (token) {
      const v = token.values[mode] ?? Object.values(token.values)[0];
      if (v) {
        if (v.type === "raw" && typeof v.value === "string") hex = v.value;
        else if (v.type === "alias") hex = tokenHexByRef(v.token);
        else if (v.type === "tailwind") {
          const tw = getTailwindColor(v.color);
          hex = tw?.hex ?? null;
        } else if (v.type === "derived") {
          hex = resolveDerivationToHex(v.base, v.ops, tokenHexByRef);
        }
      }
    }
    visiting.delete(ref);
    cache.set(ref, hex);
    return hex;
  };

  const cssVarFor = (ref: TokenRef): string | null => {
    const path = pathMap.get(ref);
    if (!path) return null;
    return `var(--${path.replace(/\./g, "-")})`;
  };

  // Numeric resolver used by expression tokens. Walks raw / alias /
  // expression in the requested mode. Fluid tokens collapse to `maxPx`.
  // Cache key is `${ref}:${mode}` so multi-mode exports don't poison each
  // other's results.
  const pxCache = new Map<string, number | null>();
  const pxVisiting = new Set<string>();
  const tokenPxByRef = (ref: TokenRef, lookupMode: string): number | null => {
    const cacheKey = `${ref}:${lookupMode}`;
    if (pxCache.has(cacheKey)) return pxCache.get(cacheKey) ?? null;
    if (pxVisiting.has(cacheKey)) return null;
    pxVisiting.add(cacheKey);
    let px: number | null = null;
    const token = tokensByRef.get(ref);
    if (token) {
      if (typeof token.maxPx === "number") {
        px = token.maxPx;
      } else {
        const v = token.values[lookupMode] ?? Object.values(token.values)[0];
        if (v) {
          if (v.type === "raw") px = coerceToPx(v.value);
          else if (v.type === "alias") px = tokenPxByRef(v.token, lookupMode);
          else if (v.type === "expression") {
            px = resolveExpressionToNumber(v.formula, (name) =>
              tokenPxByRef(name, lookupMode)
            );
          }
        }
      }
    }
    pxVisiting.delete(cacheKey);
    pxCache.set(cacheKey, px);
    return px;
  };

  return { tokenHexByRef, cssVarFor, resolveHexAtMode, tokenPxByRef };
}

function coerceToPx(value: unknown): number | null {
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

/**
 * Returned from `resolveTokenValue` when a derived value emits both a
 * static `$value` and CSS metadata for `$extensions`.
 */
interface ResolvedTokenOutput {
  value:
    | string
    | number
    | boolean
    | number[]
    | Record<string, string | number | boolean | number[]>
    | Array<Record<string, string | number | boolean | number[]>>
    | undefined;
  extensions?: Record<string, unknown>;
}

/**
 * Resolve a token value to its DTCG output value (and any extensions
 * for tailwind / derived / expression tokens).
 */
function resolveTokenValue(
  tokenValue: TokenValue,
  tokenType: string,
  pathMap: Map<string, string>,
  resolveCtx?: ResolveCtx,
  mode?: string
): ResolvedTokenOutput {
  const wrap = (v: ResolvedTokenOutput["value"]): ResolvedTokenOutput => ({
    value: v,
  });
  // Alias refs ARE names — serialize as the token's full DTCG path
  // (collection prefix + name). Unknown refs pass through verbatim so
  // the intended reference survives in the output.
  const aliasPath = (ref: TokenRef): string => {
    const path = pathMap.get(ref);
    return path ? `{${path}}` : `{${ref}}`;
  };
  if (tokenValue.type === "alias") {
    return wrap(aliasPath(tokenValue.token));
  }
  if (tokenValue.type === "tailwind") {
    // Resolve Tailwind palette references to their hex/OKLCH value so
    // consumers don't need to know about Tailwind-specific references.
    // The original palette name and the Tailwind v4 variable form are
    // preserved in $extensions for tooling that keeps the runtime cascade.
    const tw = getTailwindColor(tokenValue.color);
    if (tw) {
      return {
        value: tokenType === "color" ? hexToOklchString(tw.hex) : tw.hex,
        extensions: {
          tailwindColor: tokenValue.color, // Store original reference for tooling
          css: { value: `var(--color-${tokenValue.color})` },
        },
      };
    }
    // Non-color default-theme utilities (font-weight, leading, tracking,
    // text, spacing, …) resolve to their raw CSS value; the Tailwind v4
    // variable form is preserved in $extensions.
    const util = getTailwindUtility(tokenValue.color);
    if (util) {
      return {
        value: util.value,
        extensions: {
          tailwindUtility: tokenValue.color,
          css: { value: util.cssVar },
        },
      };
    }
    return wrap(`{unresolved-tailwind:${tokenValue.color}}`);
  }
  if (tokenValue.type === "composite") {
    // Composite: resolve each sub-slot (alias becomes `{token.path}`, raw is
    // inlined). Layered composites (array form — multi-layer shadows) render
    // as an array $value per the DTCG spec.
    const resolveLayer = (
      layer: CompositeLayer
    ): Record<string, string | number | boolean | number[]> => {
      const composite: Record<string, string | number | boolean | number[]> =
        {};
      for (const [slot, sub] of Object.entries(layer)) {
        if (sub.type === "alias") {
          composite[slot] = aliasPath(sub.token);
        } else if (sub.type === "tailwind") {
          // Resolve a Tailwind ref slot (e.g. fontWeight → 700,
          // lineHeight → 1.25) to its default-theme value.
          const twColor = getTailwindColor(sub.color);
          composite[slot] =
            twColor?.hex ?? getTailwindUtility(sub.color)?.value ?? `{unresolved-tailwind:${sub.color}}`;
        } else if (slot === "timingFunction") {
          // DTCG transition: timingFunction is a cubicBezier value — the
          // 4-number array form, not the stored string.
          composite[slot] = parseCubicBezier(sub.value) ?? sub.value;
        } else {
          composite[slot] = sub.value;
        }
      }
      return composite;
    };
    return wrap(
      Array.isArray(tokenValue.layers)
        ? tokenValue.layers.map(resolveLayer)
        : resolveLayer(tokenValue.layers)
    );
  }
  if (tokenValue.type === "derived" && resolveCtx) {
    const hex = resolveDerivationToHex(
      tokenValue.base,
      tokenValue.ops,
      resolveCtx.tokenHexByRef
    );
    const tailwindVar = (color: string) => `var(--color-${color})`;
    const cssExpr = emitCssRelativeColor(
      tokenValue.base,
      tokenValue.ops,
      resolveCtx.cssVarFor,
      tailwindVar,
      resolveCtx.tokenHexByRef
    );
    const value = tokenType === "color" ? hexToOklchString(hex) : hex;
    return {
      value,
      extensions: { css: { value: cssExpr } },
    };
  }
  if (tokenValue.type === "expression" && resolveCtx) {
    // The formula's identifiers ARE token names — no ref map to thread.
    const lookupMode = mode ?? "default";
    const px = resolveExpressionToNumber(tokenValue.formula, (name) =>
      resolveCtx.tokenPxByRef(name, lookupMode)
    );
    const baked = px === null ? "0" : `${parseFloat(px.toFixed(4))}px`;
    let cssExpr = "0";
    try {
      const { ast } = parseExpression(tokenValue.formula);
      cssExpr = emitCssExpression(
        ast,
        (name) => resolveCtx.cssVarFor(name) ?? "0"
      );
    } catch {
      cssExpr = "0";
    }
    return {
      value: baked,
      extensions: { css: { value: cssExpr } },
    };
  }
  // Diagnostic: catch the silent-empty-value bug. Any non-"raw" value
  // that reaches this fall-through means one of the kind-branches above
  // returned early on a precondition failure (e.g. missing `resolveCtx`
  // for a derived/expression value). Log the actual state so the next
  // recurrence is debuggable, instead of silently emitting `""`.
  if (tokenValue.type !== "raw") {
    // eslint-disable-next-line no-console
    console.warn("[dtcg-export] non-raw value fell through to raw emit", {
      type: tokenValue.type,
      mode,
      keys: Object.keys(tokenValue),
      hasResolveCtx: Boolean(resolveCtx),
    });
  }
  const rawValue =
    tokenValue.type === "raw" &&
    (typeof tokenValue.value === "string" ||
      typeof tokenValue.value === "number" ||
      typeof tokenValue.value === "boolean")
      ? tokenValue.value
      : "";
  if (
    tokenType === "color" &&
    typeof rawValue === "string" &&
    isHexColor(rawValue)
  ) {
    return wrap(hexToOklchString(rawValue));
  }
  // cubicBezier values are stored as strings ("0.4, 0, 0.2, 1"); the DTCG
  // $value is the 4-number control-point array.
  if (tokenType === "cubicBezier") {
    return wrap(parseCubicBezier(rawValue) ?? rawValue);
  }
  return wrap(rawValue);
}

// Parse a cubicBezier raw value into the DTCG 4-number control-point
// array. Accepts "0.4, 0, 0.2, 1" and "cubic-bezier(0.4, 0, 0.2, 1)".
function parseCubicBezier(raw: string | number | boolean): number[] | null {
  if (typeof raw !== "string") return null;
  const inner = raw
    .trim()
    .replace(/^cubic-bezier\(\s*/i, "")
    .replace(/\)$/, "");
  const parts = inner.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts;
}

/**
 * Place a token object into a group, handling nested names (e.g., "blue.500")
 */
function placeTokenInGroup(
  group: Record<string, unknown>,
  tokenName: string,
  tokenObj: Record<string, unknown>
): void {
  const nameParts = tokenName.split(".");
  let current = group;
  for (let i = 0; i < nameParts.length - 1; i++) {
    const key = nameParts[i];
    if (!(key in current)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  // Merge instead of overwrite: when a token shares a name prefix with
  // another token (e.g. `popover` and `popover.hover`), the parent token's
  // $value lands at the same key that holds its children. Whichever was
  // placed first must not be clobbered by the second. Children placed
  // earlier appear as `{hover: {...}}`; the parent's leaf fields
  // (`$value`, `$type`, `$extensions`, …) are merged in alongside.
  const lastKey = nameParts[nameParts.length - 1];
  const existing = current[lastKey];
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    current[lastKey] = { ...(existing as Record<string, unknown>), ...tokenObj };
  } else {
    current[lastKey] = tokenObj;
  }
}

// =============================================================================
// MAIN EXPORT FUNCTIONS
// =============================================================================

/**
 * Build the DTCG group object for a single collection. Shared between
 * single-file and per-collection output. Returns null when the collection has
 * no tokens. Aliases reference cross-collection paths via `pathMap`, which
 * the caller is responsible for building from the full collection set.
 */
function buildCollectionGroup(
  collection: CollectionDoc,
  pathMap: Map<string, string>,
  mode: string,
  resolveCtx: ResolveCtx
): Record<string, unknown> | null {
  const collectionTokens = collection.tokens;
  if (collectionTokens.length === 0) return null;
  const collectionGroup: Record<string, unknown> = {};

  // Determine if we can use collection-level $type
  const types = new Set(
    collectionTokens.map((t) => getEffectiveType(collection, t))
  );
  if (types.size === 1) {
    collectionGroup.$type = types.values().next().value;
  }

  // Add collection description based on kind
  const kind = getEffectiveKind(collection);
  if (kind === "color") {
    collectionGroup.$description = `Color scale collection with ${collectionTokens.length} tokens. Generated using OKLCH color space.`;
  } else if (kind === "fluid") {
    collectionGroup.$description = `Fluid scale collection with ${collectionTokens.length} tokens. Uses CSS clamp() for responsive values.`;
  } else if (kind === "themes") {
    collectionGroup.$description = `Theme tokens with ${collectionTokens.length} semantic color roles across ${collection.modes.length} themes.`;
  } else if (kind === "spacing") {
    collectionGroup.$description = `Spacing scale with ${collectionTokens.length} tokens. Uses CSS clamp() for responsive values.`;
  } else if (kind === "typography") {
    collectionGroup.$description = `Typography scale with ${collectionTokens.length} tokens. Uses CSS clamp() for responsive values.`;
  }

  // Helper: build the DTCG token object for a given (token, mode) pair, or
  // return null if no usable value exists. Applies base-mode inheritance so
  // non-base modes fall back to the base value when not explicitly set.
  const baseMode = collection.modes[0];
  const buildTokenObj = (
    token: TokenDoc,
    modeName: string
  ): Record<string, unknown> | null => {
    const tokenType = getEffectiveType(collection, token);
    const tokenValue =
      token.values[modeName] ??
      token.values[baseMode] ??
      Object.values(token.values)[0];
    if (!tokenValue) return null;

    const resolved = resolveTokenValue(
      tokenValue,
      tokenType,
      pathMap,
      resolveCtx,
      modeName
    );
    if (resolved.value === undefined) return null;

    const tokenObj: Record<string, unknown> = { $value: resolved.value };
    if (types.size > 1) {
      tokenObj.$type = tokenType;
    }
    if (token.description) {
      tokenObj.$description = token.description;
    }

    // Merge any extensions: derived metadata + fluid min/max.
    // Helper-generated tokens deliberately ship no per-token
    // extension block — provenance & rule shape live in the
    // collection-level $extensions.com.designsystembuilder.levelRules
    // block so the same info isn't duplicated 30+ times.
    const extensions: Record<string, unknown> = {};
    if (resolved.extensions) Object.assign(extensions, resolved.extensions);
    const dsb: Record<string, unknown> = {};
    if (token.minPx !== undefined || token.maxPx !== undefined) {
      dsb.fluid = { minPx: token.minPx, maxPx: token.maxPx };
    }
    if (Object.keys(dsb).length > 0) {
      extensions["com.designsystembuilder"] = dsb;
    }
    if (Object.keys(extensions).length > 0) {
      tokenObj.$extensions = extensions;
    }
    return tokenObj;
  };

  // Multi-mode collections: output each mode as a sub-group.
  // Single-mode collections: output tokens flat under the collection.
  if (collection.modes.length > 1) {
    // Add extensions with mode metadata
    const extensionMeta: Record<string, unknown> = {
      modes: collection.modes,
    };
    if (collection.tailwind?.semantic?.modeSelectors) {
      extensionMeta.modeSelectors = collection.tailwind.semantic.modeSelectors;
    }
    if (collection.tailwind?.enabled) {
      // Tailwind v4 opt-in for this collection (utility mapping and/or
      // semantic theming) — consumed by Tailwind-aware build tooling.
      extensionMeta.tailwind = {
        enabled: true,
        ...(collection.tailwind.utility
          ? { utility: collection.tailwind.utility }
          : {}),
      };
    }
    // For themes collections with a surfaces helper, attach per-level
    // generic CSS expressions. Consumers can wire these once at :root
    // (set `--surface` + `--fg` per scope) and skip authoring
    // per-surface level tokens entirely. Per-surface bakes are still
    // emitted as concrete tokens for Figma / non-CSS consumers.
    if (collection.surfacesConfig && kind === "themes") {
      const aliasName = (ref: TokenRef): string | null =>
        pathMap.get(ref) ?? null;
      const levelRules = expressLevelRulesGeneric(
        collection.surfacesConfig as SurfacesConfig,
        { surfaceVar: "--surface", fgVar: "--fg", aliasName }
      );
      if (Object.keys(levelRules).length > 0) {
        extensionMeta.levelRules = levelRules;
      }
    }
    collectionGroup.$extensions = {
      "com.designsystembuilder": extensionMeta,
    };

    // Create a sub-group per mode
    for (const modeName of collection.modes) {
      const modeGroup: Record<string, unknown> = {};

      // Add tailwind selector extension per mode (themes collections only)
      const selector = collection.tailwind?.semantic?.modeSelectors?.[modeName];
      if (selector) {
        modeGroup.$extensions = {
          tailwind: { selector },
        };
      }

      for (const token of collectionTokens) {
        const tokenObj = buildTokenObj(token, modeName);
        if (!tokenObj) continue;
        placeTokenInGroup(modeGroup, token.name, tokenObj);
      }

      collectionGroup[modeName] = modeGroup;
    }
  } else {
    // Single-mode collections: output tokens directly under the collection.
    const only = collection.modes[0] ?? mode;
    for (const token of collectionTokens) {
      const tokenObj = buildTokenObj(token, only);
      if (!tokenObj) continue;
      placeTokenInGroup(collectionGroup, token.name, tokenObj);
    }
    if (collection.tailwind?.enabled) {
      collectionGroup["$extensions"] = {
        ...(collectionGroup["$extensions"] as Record<string, unknown> | undefined),
        "com.designsystembuilder": {
          tailwind: {
            enabled: true,
            ...(collection.tailwind.utility
              ? { utility: collection.tailwind.utility }
              : {}),
          },
        },
      };
    }
  }

  return collectionGroup;
}

/**
 * Generate DTCG-compliant tokens.json content (single combined file).
 *
 * `collections` must already be recomputed — generated tokens (from
 * generators and the surfaces helper) present in each `tokens` array.
 * They export exactly like hand-authored tokens.
 */
export function generateTokensJson(
  collections: CollectionDoc[],
  mode: string = "default"
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const pathMap = buildTokenPathMap(collections);
  const resolveCtx = buildResolveCtx(collections, pathMap, mode);

  for (const collection of collections) {
    const group = buildCollectionGroup(collection, pathMap, mode, resolveCtx);
    if (!group) continue;
    output[normalizeCollectionName(collection.name)] = group;
  }

  return output;
}

/**
 * Generate one tokens file per collection. Returns a map of
 * normalizedCollectionName → tokens content. Each file's contents are the
 * collection group placed at the top level (no collection-name wrapper) so
 * downstream tools can consume it as a self-contained DTCG document.
 *
 * Aliases still resolve via paths that include the collection prefix, so the
 * files are intended to be loaded together by consumers — they're a layout
 * choice, not isolated namespaces.
 */
export function generateTokensJsonByCollection(
  collections: CollectionDoc[],
  mode: string = "default"
): Record<string, Record<string, unknown>> {
  const output: Record<string, Record<string, unknown>> = {};
  const pathMap = buildTokenPathMap(collections);
  const resolveCtx = buildResolveCtx(collections, pathMap, mode);

  for (const collection of collections) {
    const group = buildCollectionGroup(collection, pathMap, mode, resolveCtx);
    if (!group) continue;
    const fileName = normalizeCollectionName(collection.name);
    // Wrap the group under its collection key so alias paths
    // (e.g. "core.color.blue.500") resolve correctly when consumed.
    output[fileName] = { [fileName]: group };
  }

  return output;
}

/**
 * Generate $metadata.json content with generator + surfaces configs.
 *
 * Pass `layout` so the embedded `$meta` block can advertise the published
 * file list — loaders use this to discover and merge per-collection files
 * without guessing filenames. `generatedAt` is injectable so tests can be
 * deterministic; it defaults to the current time.
 */
export function generateMetadataJson(
  system: SystemDoc,
  collections: CollectionDoc[],
  layout: ExportLayout = "single",
  generatedAt: string = new Date().toISOString()
): DtcgMetadata {
  // Collect all unique modes across collections
  const allModes = new Set<string>();
  for (const collection of collections) {
    for (const mode of collection.modes) {
      allModes.add(mode);
    }
  }

  // Build collection metadata
  const collectionsMetadata: Record<string, CollectionMetadata> = {};

  for (const collection of collections) {
    const collectionPath = normalizeCollectionName(collection.name);
    const kind = getEffectiveKind(collection);

    const meta: CollectionMetadata = {
      kind,
      modes: collection.modes,
    };

    if (collection.generators && collection.generators.length > 0) {
      meta.generators = collection.generators.map((gen) => {
        let genMeta: ColorScaleGeneratorMeta | FluidScaleGeneratorMeta;
        if (gen.config.type === "color") {
          const cc = gen.config.colorScaleConfig;
          genMeta = {
            type: "colorScale",
            steps: cc.steps,
            families: cc.families.map((family) => ({
              name: family.name,
              lightness: extractChannelConfigMeta(family.lightness),
              chroma: extractChannelConfigMeta(family.chroma),
              hue: extractChannelConfigMeta(family.hue),
            })),
            syncedChannels: cc.syncedChannels,
          };
        } else if (gen.config.type === "spacing") {
          // Wrap spacing config in FluidScaleGeneratorMeta format. The
          // viewport is the system's shared fluid viewport (the cloud
          // export emitted zeros here because the design system wasn't
          // in scope — it is now).
          const sc = gen.config.spacingConfig;
          genMeta = {
            type: "fluidScale",
            viewport: {
              minWidth: system.fluid.viewport.minWidth,
              maxWidth: system.fluid.viewport.maxWidth,
            },
            breakpoints: system.fluid.breakpoints,
            spacing: {
              baseMin: sc.baseMin,
              baseMax: sc.baseMax,
              steps: sc.steps.map((s) => ({
                name: s.name,
                multiplier: s.multiplier,
              })),
              ...(sc.fixedSteps && sc.fixedSteps.length > 0
                ? { fixedSteps: sc.fixedSteps.map((f) => ({ value: f.value })) }
                : {}),
              includePairs: sc.includePairs,
              customPairs: sc.customPairs,
              unit: sc.unit,
              prefix: sc.prefix,
            },
          };
        } else {
          const tc = gen.config.typographyConfig;
          genMeta = {
            type: "fluidScale",
            viewport: {
              minWidth: system.fluid.viewport.minWidth,
              maxWidth: system.fluid.viewport.maxWidth,
            },
            breakpoints: system.fluid.breakpoints,
            typography: {
              steps: tc.steps.map((s) => ({ minPx: s.minPx, maxPx: s.maxPx })),
              unit: tc.unit,
              prefix: tc.prefix,
              ...(tc.baseStepIndex !== undefined
                ? { baseStepIndex: tc.baseStepIndex }
                : {}),
            },
          };
        }
        return {
          id: gen.id,
          type: gen.type,
          groupPrefix: gen.groupPrefix,
          generator: genMeta,
        };
      });
    }

    // Surfaces helper config — emitted verbatim (JSON-safe, name-based)
    // so consumers/clones can rebuild the helper state. The cloud
    // product never serialized this; token-vault closes that gap.
    if (collection.surfacesConfig) {
      meta.surfacesConfig = collection.surfacesConfig as SurfacesConfig;
    }

    collectionsMetadata[collectionPath] = meta;
  }

  const files =
    layout === "per-collection"
      ? collections.map((c) => `${normalizeCollectionName(c.name)}.json`)
      : ["tokens.json"];

  return {
    $schema: "https://designsystembuilder.dev/schemas/metadata-v1.json",
    version: "1.0.0",
    generatedAt,
    $meta: {
      name: system.name,
      exportLayout: layout,
      files,
      generatedAt,
    },
    designSystem: {
      name: system.name,
      description: system.description,
    },
    modes: Array.from(allModes),
    collections: collectionsMetadata,
  };
}

/**
 * Generate both tokens.json and $metadata.json. The layout defaults to
 * the system's configured `exportLayout` (falling back to "single").
 */
export function generateDtcgExport(
  system: SystemDoc,
  collections: CollectionDoc[],
  mode: string = "default",
  layout: ExportLayout = system.exportLayout ?? "single",
  generatedAt?: string
): DtcgExportResult {
  const result: DtcgExportResult = {
    tokens: generateTokensJson(collections, mode),
    metadata: generateMetadataJson(system, collections, layout, generatedAt),
  };
  if (layout === "per-collection") {
    result.tokenFiles = generateTokensJsonByCollection(collections, mode);
  }
  // Surface recipes as a first-class `surface-recipe` token group (the
  // seed-driven relative-color rules). Opt-in via `surfaceRecipes`.
  if (system.surfaceRecipes === "dtcg" || system.surfaceRecipes === "both") {
    const recipes = buildSurfaceRecipes(collections);
    if (recipes.length > 0) {
      const group = recipesToDtcgGroup(recipes);
      result.tokens["surface-recipe"] = group;
      if (result.tokenFiles) {
        result.tokenFiles["surface-recipe"] = { "surface-recipe": group };
      }
    }
  }
  return result;
}

/**
 * Serialize tokens for consistent output (sorted keys)
 */
export function serializeTokens(tokens: Record<string, unknown>): string {
  return JSON.stringify(sortObjectKeys(tokens), null, 2);
}

/**
 * Serialize metadata for consistent output (sorted keys)
 */
export function serializeMetadata(metadata: DtcgMetadata): string {
  return JSON.stringify(sortObjectKeys(metadata), null, 2);
}
