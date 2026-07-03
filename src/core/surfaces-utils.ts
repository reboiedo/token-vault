/**
 * Surfaces helper — materialization logic.
 *
 * Each level/branch is a *mix toward an fg anchor* in OKLCH space.
 *   - 1.0 = pure anchor (white on dark surfaces, black on light, by
 *     default — overridable per branch).
 *   - 0.0 = the surface itself (level is invisible).
 *   - 0.7 ≈ classic muted fg, 0.35 ≈ disabled, 0.15 ≈ border.
 *
 * The big win over absolute OKLCH targets: the level *tracks* the
 * surface. A `fg-muted` rule that reads correctly on a deep blue
 * surface also reads correctly on a yellow surface, because both are
 * authored as "70% of the way toward the contrasting fg from this
 * specific surface."
 *
 * Polarity per (surface, mode) decides which branch (`onLight` vs
 * `onDark`) applies AND what "auto" means for the anchor. Auto = white
 * when surface is dark, black when light — the obvious contrast.
 */

import { formatHex, parse } from "culori";
import type { TokenRef } from "./types";
import { solveForApcaLc } from "./apca-utils";
import { hexToOklch, oklchToHex } from "./color-utils";
import { getTailwindFamily, getTailwindHex } from "./tailwind-colors";
import {
  resolveDerivationToHex,
  type DerivationBase,
  type DerivationOp,
} from "./derivation";

/**
 * Normalize an arbitrary CSS color string to a hex. Handles named
 * colors (`white`, `black`, …), rgb()/hsl()/oklch()/hex inputs.
 * Returns null if the input isn't parseable. Used at the alias
 * resolution boundary so a token whose value happens to be the
 * literal string `"white"` doesn't render as black.
 */
export function normalizeToHex(value: string | null | undefined): string | null {
  if (!value) return null;
  // Pass 3/6/8-digit hex through verbatim so true-alpha (`#rrggbbaa`)
  // colors aren't flattened by culori's opaque `formatHex`.
  if (/^#[0-9a-f]{3}(?:[0-9a-f]{3}(?:[0-9a-f]{2})?)?$/i.test(value)) {
    return value;
  }
  try {
    const parsed = parse(value);
    if (!parsed) return null;
    return formatHex(parsed) ?? null;
  } catch {
    return null;
  }
}

/**
 * Append an alpha channel to an opaque hex, producing `#rrggbbaa`.
 * `alpha` is 0..1; a value of 1 returns the original 6-digit hex.
 */
export function withAlpha(hex: string, alpha: number): string {
  const base = normalizeToHex(hex) ?? "#000000";
  // Expand shorthand / strip any existing alpha to a 6-digit base.
  let h = base.replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  h = h.slice(0, 6).padEnd(6, "0");
  const a = Math.max(0, Math.min(1, alpha));
  if (a >= 1) return `#${h}`;
  const aa = Math.round(a * 255).toString(16).padStart(2, "0");
  return `#${h}${aa}`;
}

/**
 * Family of a tailwind color name ("blue-600" → "blue"), or null when
 * the name doesn't resolve to a known palette family.
 */
export function tailwindFamilyOf(color: string): string | null {
  const dash = color.lastIndexOf("-");
  if (dash < 0) return null;
  const family = color.slice(0, dash);
  return getTailwindFamily(family) ? family : null;
}

/**
 * Flatten a (possibly translucent) hex onto an opaque backdrop, returning
 * the solid color the tint visually becomes when drawn over `bgHex`.
 * Opaque inputs (3/6-digit) pass through unchanged.
 *
 * Contrast (APCA) is undefined against a see-through color, so when a fg
 * rule measures against a true-alpha level (e.g. a `soft` tint) we first
 * composite that level over the page background it sits on — otherwise the
 * solver has nothing to measure against and bails to the surface color.
 * Compositing uses the same OKLCH lerp as `applyOpacity` for consistency.
 */
export function compositeTranslucentOver(hex: string, bgHex: string): string {
  const norm = normalizeToHex(hex);
  if (!norm) return hex;
  const clean = norm.replace(/^#/, "");
  if (clean.length !== 8) return norm; // already opaque
  const alpha = parseInt(clean.slice(6, 8), 16) / 255;
  if (alpha >= 1) return `#${clean.slice(0, 6)}`;
  const src = hexToOklch(`#${clean.slice(0, 6)}`);
  const bg = hexToOklch(bgHex);
  const out = oklchLerp(bg, src, alpha);
  return oklchToHex(out.l, out.c, out.h);
}

/**
 * Minimal shape the base-hex resolver needs from each alias option.
 * Identity is the dotted `name` — there is no separate id.
 */
export interface AliasResolvable {
  name: string;
  resolvedValue?: string;
  resolvedByMode?: Record<string, string>;
}

/**
 * Build the `resolveBaseHex(ref, mode)` function the surfaces
 * materializer needs. Resolves a token ref (dotted name) to its current
 * hex via `aliasOptions` (per-mode aware), and — crucially — routes
 * references to a *peer surface's* materialized base back through the
 * live `surfaces` config so peer aliases reflect the current (possibly
 * unsaved) base, not the last persisted value. Shared by the editor and
 * the store recompute so both resolve identically.
 */
export function makeResolveBaseHex(
  aliasOptions: AliasResolvable[],
  surfaces: SurfaceRow[]
): (ref: TokenRef, mode?: string) => string | null {
  const byName = new Map<string, AliasResolvable>();
  for (const o of aliasOptions) byName.set(o.name, o);
  return (ref: TokenRef, mode?: string): string | null => {
    const visited = new Set<TokenRef>();
    const walk = (currentRef: TokenRef): string | null => {
      if (visited.has(currentRef)) return null;
      visited.add(currentRef);
      const opt = byName.get(currentRef);
      if (!opt) return null;
      // 1. If this alias points at a peer surface's materialized base,
      //    follow it through the LIVE config so unsaved edits to bg flow
      //    into field, instead of snapshotting the previous DB value.
      const peer = surfaces.find(
        (s) => s.materializeBase && s.name === opt.name
      );
      if (peer && mode) {
        const peerBase = peer.baseByMode[mode];
        if (peerBase?.kind === "raw") return normalizeToHex(peerBase.value);
        if (peerBase?.kind === "alias") return walk(peerBase.token);
        if (peerBase?.kind === "derived") {
          try {
            return resolveDerivationToHex(peerBase.base, peerBase.ops, (pid) => walk(pid)
            );
          } catch {
            return null;
          }
        }
        // peerBase undefined for this mode → fall through to query.
      }
      // 2. Fall back to the resolved-value lookup (per-mode aware).
      if (mode && opt.resolvedByMode?.[mode]) {
        return normalizeToHex(opt.resolvedByMode[mode]);
      }
      return normalizeToHex(opt.resolvedValue);
    };
    return walk(ref);
  };
}

/**
 * Build the `resolveScaleStep` function a `scale-step` level needs.
 * Given a *source* token (the surface's base, or an explicit scale
 * token), it derives the scale prefix from the source token's dotted
 * name (everything before the last `.`) and resolves the sibling token
 * `<prefix>.<step>` to its per-mode hex. Returns null when the source
 * isn't a scale token (no dot) or the requested step doesn't exist —
 * the materializer then falls back to the surface base.
 */
export function makeResolveScaleStep(
  aliasOptions: AliasResolvable[]
): ResolveScaleStep {
  const byName = new Map<string, AliasResolvable>();
  for (const o of aliasOptions) byName.set(o.name, o);
  return (sourceRef, step, mode) => {
    // The ref IS the dotted name — the scale prefix reads directly off it.
    const dot = sourceRef.lastIndexOf(".");
    if (dot < 0) return null; // not a `<scale>.<step>` token
    const prefix = sourceRef.slice(0, dot);
    const target = byName.get(`${prefix}.${step}`);
    if (!target) return null; // step doesn't exist → caller falls back
    const raw = target.resolvedByMode?.[mode] ?? target.resolvedValue;
    return raw ? normalizeToHex(raw) : null;
  };
}

// ============================================================================
// SURFACE BASE RESOLUTION
// ============================================================================

/**
 * Resolve a `SurfaceBaseValue` to a hex string, honoring the cell's mode
 * for alias/derived references. Returns null when the base can't be
 * resolved (e.g. an alias to a token that no longer exists, or a derived
 * pipeline whose target token isn't loaded yet).
 *
 * Centralized here so every materializer / preview callsite that used to
 * branch on `base.kind` stays in sync as new kinds are added.
 */
export function resolveSurfaceBaseHex(
  base: SurfaceBaseValue | undefined,
  mode: string | undefined,
  resolveBaseHex: (id: TokenRef, mode?: string) => string | null
): string | null {
  if (!base) return null;
  if (base.kind === "raw") return base.value;
  if (base.kind === "alias") return resolveBaseHex(base.token, mode);
  // derived
  try {
    return resolveDerivationToHex(base.base, base.ops, (id) => resolveBaseHex(id, mode)
    );
  } catch {
    return null;
  }
}

// ============================================================================
// TYPES — mirror schema.ts validators
// ============================================================================

export type SurfaceBaseValue =
  | { kind: "raw"; value: string }
  | { kind: "alias"; token: TokenRef }
  // A derivation from another token (or tailwind / raw hex) via the same
  // OKLCH op pipeline as the token table's "Derive" feature. Lets a
  // surface base be e.g. "purple.700 darkened by 0.1, mixed 20% with
  // black" without authoring an intermediate token.
  | {
      kind: "derived";
      base: DerivationBase;
      ops: DerivationOp[];
    };

export type SurfacePolarity = "auto" | "light" | "dark";

export type SurfaceLevelAnchor =
  | { kind: "auto" }
  | { kind: "raw"; value: string }
  | { kind: "alias"; token: TokenRef }
  // A Tailwind v4 palette color, e.g. "slate-950".
  | { kind: "tailwind"; color: string }
  // The current surface's own base — resolves per-surface (e.g. on the
  // `highlight` surface this is `highlight`, on `info` it's `info`).
  | { kind: "surface" };

/**
 * Unified per-mode fg behaviour for a surface. One choice covers
 * both polarity (which level branch applies) AND the anchor (what
 * color the levels lerp toward). See `resolveFgFor` for the mapping.
 */
export type SurfaceFgChoice =
  | { kind: "auto" }                                // polarity from surface luminance
  | { kind: "light" }                               // light fg (= white anchor, surface treated as dark)
  | { kind: "dark" }                                // dark fg  (= black anchor, surface treated as light)
  | { kind: "alias"; token: TokenRef }        // fg = token's resolved hex; polarity from token luminance
  | { kind: "tailwind"; color: string };            // fg = tailwind palette hex; polarity from its luminance

export interface SurfaceRow {
  id: string;
  name: string;
  baseByMode: Record<string, SurfaceBaseValue>;
  /** Unified per-mode fg behaviour. Preferred over the legacy fields below. */
  fgByMode?: Record<string, SurfaceFgChoice>;
  /** Emit `<surface.name>` as a token with the resolved base. */
  materializeBase?: boolean;
  /** Drop the `<surface>.` prefix on this surface's level tokens. */
  bareLevels?: boolean;
  /**
   * Per-level state + optional rule override for this surface, keyed
   * by level id. Supersedes `excludeLevels` / `excludeAllLevels`.
   *
   * Three states per (surface, level):
   *   - NO entry          → "default": inherit the global level rule
   *   - { state: "disabled" }            → surface skips this level
   *   - { state: "override"; rule: ... } → surface emits a custom rule
   *
   * The reserved `"*"` key encodes the old `excludeAllLevels`
   * semantic: any level lacking an explicit entry is disabled
   * (including levels added to the global config later), so base-only
   * surfaces (accent, brand swatches) don't quietly start emitting
   * new levels.
   */
  levelStates?: Record<string, SurfaceLevelOverride>;
  /** @deprecated migrated into `levelStates`; read-only fallback. */
  excludeLevels?: string[];
  /** @deprecated migrated into `levelStates["*"]`; read-only fallback. */
  excludeAllLevels?: boolean;
  /** @deprecated kept for back-compat; use fgByMode. */
  polarityByMode?: Record<string, SurfacePolarity>;
  /** @deprecated kept for back-compat; use fgByMode. */
  fgAnchorByMode?: Record<string, SurfaceLevelAnchor>;
}

/**
 * Per-surface, per-level on/off state. Absence of an entry = "default"
 * (the surface emits this level using the global rule).
 *   - { state: "disabled" } → surface skips this level
 *   - { state: "default" }  → explicit "on", only needed to re-enable a
 *     single level on a surface whose `"*"` wildcard disables the rest.
 */
export type SurfaceLevelOverride =
  | { state: "default" }
  | { state: "disabled" };

/**
 * Reserved `levelStates` key meaning "disable any level without an
 * explicit entry" — the faithful translation of the legacy
 * `excludeAllLevels` flag.
 */
export const WILDCARD_LEVEL_KEY = "*";

/**
 * Target spec for a fg level branch. APCA targets a perceptual contrast
 * (Lc) against the surface — the level reads the same on every surface.
 * Mix targets a position along the surface→anchor lerp — recipe-style,
 * kept for back-compat and power-user authoring.
 */
export type SurfaceFgTarget =
  | { kind: "apca"; lc: number }   // 0..108
  | { kind: "mix"; mix: number };  // 0..1

/**
 * Which backdrop a fg level's APCA target is measured against. Default
 * (absent) = the parent surface's own base. A `level` ref points at
 * another level of the SAME surface (e.g. a raised `surface` level that
 * is lighter than `bg`, so the fg stays legible there too); an `alias`
 * ref points at a concrete color token.
 */
export type SurfaceMeasureRef =
  | { kind: "surface" }
  | { kind: "level"; levelId: string }
  | { kind: "alias"; token: TokenRef }
  | { kind: "tailwind"; color: string };

/**
 * A fg level branch. Discriminated by which field is present, mirroring
 * the schema's union:
 *   - { target, anchor }   — current shape (APCA Lc or mix-by-target)
 *   - { mix, anchor }      — pre-target legacy shape
 * Both are accepted by Convex's validator so the in-memory shape can
 * be either; `normalizeFgTarget` collapses to a `SurfaceFgTarget`.
 *
 * `measureAgainst` applies only to APCA targets.
 */
export type SurfaceLevelBranch =
  | {
      target: SurfaceFgTarget;
      anchor: SurfaceLevelAnchor;
      measureAgainst?: SurfaceMeasureRef;
    }
  | { mix: number; anchor: SurfaceLevelAnchor };

/** Lift a branch's target into the canonical SurfaceFgTarget shape. */
export function normalizeFgTarget(branch: SurfaceLevelBranch): SurfaceFgTarget {
  if ("target" in branch) return branch.target;
  return { kind: "mix", mix: branch.mix };
}

/** Read the APCA measure-against ref from a branch (target shape only). */
export function getMeasureAgainst(
  branch: SurfaceLevelBranch
): SurfaceMeasureRef | undefined {
  return "target" in branch ? branch.measureAgainst : undefined;
}


/**
 * Branch for a surface-shift level (hover/active/disabled-bg, etc).
 * Transforms the surface itself rather than mixing toward an fg.
 */
export interface SurfaceShiftBranch {
  /**
   * Signed step strength in [-1, +1]. Positive moves AWAY from the
   * surface's polarity (lifts dark surfaces, darkens light surfaces);
   * negative moves deeper into it. Materializer applies a headroom-
   * aware curve so the same value reads consistently across surfaces.
   * Preferred over the explicit `lightnessDelta` below.
   */
  stepStrength?: number;
  /**
   * @deprecated Explicit OKLCH lightness delta. Used only when
   * `stepStrength` is absent. Kept for legacy rows and as an
   * advanced/manual escape hatch.
   */
  lightnessDelta?: number;
  /** Optional OKLCH chroma delta. Negative mutes, positive saturates. */
  chromaDelta?: number;
  /**
   * Optional mix toward another color after the L/C deltas — a color
   * token or a Tailwind palette color ("slate-500").
   */
  mixWith?:
    | { token: TokenRef; weight: number }
    | { tailwind: string; weight: number };
}

/**
 * Branch for a "mix toward ink" level: lerp surface → the cell's
 * resolved fg/ink by `mix` in OKLCH, with NO L/C shift component.
 *
 * Distinct from `fg` rules (which support APCA targets + a solver-baked
 * hex) and from `surface-shift` (which transforms the surface's own
 * L/C). This is the literal `color-mix(in oklch, var(--surface),
 * var(--fg) N%)` — the canonical way to derive raised cards, fills,
 * and borders that track the surface's ink. The anchor defaults to
 * `auto` (= the cell's fg/ink) but may point at an alias for a fixed
 * tint source.
 */
export interface SurfaceMixBranch {
  /** 0..1 fraction toward the anchor (the cell's resolved fg/ink). */
  mix: number;
  /** Anchor the mix targets. Default `auto` = the cell's fg/ink. */
  anchor: SurfaceLevelAnchor;
}

/**
 * Legacy branch shape kept around purely so we can detect old configs
 * and trigger the auto-migration in the editor. Not used by the
 * materializer.
 */
export interface LegacySurfaceLevelBranch {
  l: number;
  c: number;
  hueSource: "surface" | "fixed";
  fixedHue?: number;
}

/**
 * Branch for an opacity-kind level. Encodes "use the source color at α
 * alpha." The CSS form is `rgb(from <source> r g b / α)`; the Figma
 * bake composites over the surface as a lossy approximation since
 * Figma variables can't hold alpha.
 */
export interface SurfaceOpacityBranch {
  /** 0..1 alpha applied to the source color. */
  alpha: number;
}

/**
 * Which color an opacity level fades: the surface itself, the cell's
 * fg/ink, or an explicit color token (alias). Resolved per-mode for
 * the alias case.
 */
export type SurfaceOpacitySource =
  | "surface"
  | "fg"
  | { kind: "alias"; token: TokenRef }
  | { kind: "tailwind"; color: string };

/**
 * Which scale a `scale-step` level draws from:
 *   - `parent` : the scale the surface's own base belongs to (derived
 *                per-mode from that mode's base token name).
 *   - `alias`  : a specific token — its scale prefix is used instead.
 */
export type SurfaceScaleSource =
  | { kind: "parent" }
  | { kind: "alias"; token: TokenRef }
  // A Tailwind palette family ("blue") — steps resolve to "blue-<step>".
  | { kind: "tailwind"; family: string };

/**
 * Branch for a `scale-step` level. Resolves to a specific step of the
 * source scale (e.g. step "600" of `fushia` → `fushia.600`). The scale
 * is taken from `scale` (defaults to the surface's parent scale); the
 * sibling token `<scalePrefix>.<step>` is looked up and resolved. If
 * the step (or scale) can't be resolved, the materializer falls back to
 * the surface base.
 */
export interface SurfaceScaleStepBranch {
  /** Scale step to use, e.g. "50" | "600" | "950". */
  step: string;
  /** Which scale to draw from. Absent ⇒ parent (the surface's base scale). */
  scale?: SurfaceScaleSource;
}

/**
 * Rule discriminator on a level:
 *   - `fg`            : mix toward an fg anchor (text-on-surface)
 *   - `surface-shift` : transform the surface itself (hover, active)
 *   - `opacity`       : apply alpha to the surface or fg (disabled)
 */
export type SurfaceLevelRule =
  | { kind: "fg"; onLight: SurfaceLevelBranch; onDark: SurfaceLevelBranch }
  | {
      kind: "surface-shift";
      onLight: SurfaceShiftBranch;
      onDark: SurfaceShiftBranch;
    }
  | {
      kind: "surface-mix";
      onLight: SurfaceMixBranch;
      onDark: SurfaceMixBranch;
    }
  | {
      kind: "opacity";
      source: SurfaceOpacitySource;
      /**
       * How the faded color is baked:
       *   - "alpha"      → ship a true translucent color (`#rrggbbaa`,
       *                    exported as `oklch(… / a)`); works as an
       *                    overlay on any background.
       *   - "composite"  → flatten the source at α over the surface into
       *                    an opaque hex (legacy default for back-compat).
       * Absent ⇒ "composite".
       */
      bake?: "composite" | "alpha";
      onLight: SurfaceOpacityBranch;
      onDark: SurfaceOpacityBranch;
    }
  | {
      kind: "scale-step";
      onLight: SurfaceScaleStepBranch;
      onDark: SurfaceScaleStepBranch;
    };

/**
 * How a level renders in the Preview pane (purely presentational —
 * never affects the materialized token):
 *   - "text"      : the level name drawn in its color (default)
 *   - "separator" : a full-width line in its color (borders/dividers)
 *   - "bg"        : a filled button/chip using the color as background
 */
export type SurfaceLevelDisplay = "text" | "separator" | "bg";

/**
 * Level shape. The `rule` discriminator splits between fg-mix and
 * surface-shift behaviours. Legacy rows store `onLight`/`onDark`
 * directly without a `rule` field — `normalizeLevel` below wraps
 * them.
 */
export interface SurfaceLevel {
  id: string;
  name: string;
  rule: SurfaceLevelRule;
  /** Preview rendering hint; defaults to "text". */
  display?: SurfaceLevelDisplay;
}

/**
 * Pre-`rule` shape. Kept so we can read and migrate legacy storage.
 */
export interface LegacySurfaceLevel {
  id: string;
  name: string;
  onLight: SurfaceLevelBranch | LegacySurfaceLevelBranch;
  onDark: SurfaceLevelBranch | LegacySurfaceLevelBranch;
}

export type AnyLevel = SurfaceLevel | LegacySurfaceLevel;

/**
 * Wrap a stored level (which may be in the legacy shape without a
 * `rule` field) into the canonical `rule`-shaped form. Returns null
 * if the level can't be migrated (e.g. branches are themselves in
 * the absolute-OKLCH legacy shape — those are handled by the
 * editor's separate `isLegacySurfacesConfig` reseed path).
 */
export function normalizeLevel(level: AnyLevel): SurfaceLevel | null {
  if ("rule" in level) return level;
  const onLight = level.onLight;
  const onDark = level.onDark;
  // Wrap only if both branches are in the fg-branch shape (have a
  // mix or target field). Absolute-OKLCH legacy branches are handled
  // separately by `isLegacySurfacesConfig`'s reseed path.
  const isFgBranch = (b: unknown): b is SurfaceLevelBranch =>
    !!b && typeof b === "object" && ("mix" in b || "target" in b);
  if (!isFgBranch(onLight) || !isFgBranch(onDark)) return null;
  return {
    id: level.id,
    name: level.name,
    rule: { kind: "fg", onLight, onDark },
  };
}

export interface SurfacesConfig {
  surfaces: SurfaceRow[];
  levels: SurfaceLevel[];
  contrastThreshold?: number;
}

/**
 * Per-token-per-mode descriptor that tells downstream consumers
 * (LLMs, custom build tools, CSS utility generators) which helper
 * rule produced this token and — for non-APCA rules — what the
 * equivalent CSS relative-color expression looks like.
 *
 * Lives under `$extensions.com.designsystembuilder.generatedFrom`
 * in the published `tokens.json`.
 */
export interface GeneratedFromDescriptor {
  /** Surface row's `name` (e.g. "primary"). */
  surface: string;
  /** Level's `name` (e.g. "hover"). */
  level: string;
  /**
   * Serialized form of the per-mode branch rule. For fg levels:
   * `{ kind: "fg", target: ..., anchor: ... }`. For surface-shift:
   * `{ kind: "surface-shift", stepStrength?, chromaDelta?, mixWith? }`.
   * Alias references (in anchor or mixWith) are rewritten from
   * Convex `token`s to DTCG dotted names where available.
   */
  rule: SerializedRule;
  /**
   * CSS relative-color expression assuming `var(--surface)` is set
   * by the consumer's scope. Omitted for APCA targets (no closed
   * form). Numerical deltas are pre-resolved to the (surface, mode)
   * cell so the expression is a self-contained constant.
   */
  css?: string;
}

export type SerializedMeasureRef =
  | { kind: "surface" }
  | { kind: "level"; level: string }
  | { kind: "alias"; tokenName: string }
  | { kind: "tailwind"; color: string };

export type SerializedRule =
  | {
      kind: "fg";
      target: SurfaceFgTarget;
      anchor: SerializedAnchor;
      measureAgainst?: SerializedMeasureRef;
    }
  | {
      kind: "surface-shift";
      stepStrength?: number;
      lightnessDelta?: number;
      chromaDelta?: number;
      mixWith?:
        | { tokenName: string; weight: number }
        | { tailwind: string; weight: number };
    }
  | {
      kind: "surface-mix";
      mix: number;
      anchor: SerializedAnchor;
    }
  | {
      kind: "opacity";
      source:
        | "surface"
        | "fg"
        | { kind: "alias"; tokenName: string }
        | { kind: "tailwind"; color: string };
      alpha: number;
      bake?: "composite" | "alpha";
    }
  | {
      kind: "scale-step";
      step: string;
      scale:
        | "parent"
        | { kind: "alias"; tokenName: string }
        | { kind: "tailwind"; family: string };
    };

export type SerializedAnchor =
  | { kind: "auto" }
  | { kind: "raw"; value: string }
  | { kind: "alias"; tokenName: string }
  | { kind: "tailwind"; color: string }
  | { kind: "surface" };

export interface GeneratedSurfaceToken {
  name: string;
  values: Record<string, { type: "raw"; value: string }>;
  /**
   * Per-mode descriptor. Same key set as `values` (a mode might be
   * absent here if the cell didn't materialize). Populated by
   * `generateSurfaceTokens` when called with `aliasName` resolver.
   */
  meta?: Record<string, GeneratedFromDescriptor>;
}

export interface MaterializeOptions {
  /**
   * Resolve a Convex token (alias / mixWith reference) to a DTCG
   * dotted name like `color.neutral.500`. Used when serializing the
   * rule descriptor and building CSS expressions. When undefined,
   * alias-bearing rules ship without their CSS expression and the
   * descriptor uses the raw token as a fallback name.
   */
  aliasName?: (id: TokenRef) => string | null;
  /**
   * CSS variable name used as the surface in relative-color
   * expressions (e.g. "--surface"). Defaults to "--surface".
   */
  surfaceVar?: string;
  /**
   * Resolve a `scale-step` level: given a source token id (the surface
   * base, or an explicit scale token), a step ("600"), and a mode,
   * return the hex of `<sourceScalePrefix>.<step>` — or null if it
   * doesn't exist. Built via `makeResolveScaleStep`.
   */
  resolveScaleStep?: ResolveScaleStep;
}

/** Resolver for `scale-step` levels — see `makeResolveScaleStep`. */
export type ResolveScaleStep = (
  sourceTokenId: TokenRef,
  step: string,
  mode: string
) => string | null;

const DEFAULT_THRESHOLD = 0.6;

// ============================================================================
// OKLCH lerp
// ============================================================================

interface Oklch {
  l: number;
  c: number;
  h: number;
}

/**
 * Interpolate two OKLCH colors. Hue uses shortest-arc; if either side
 * is achromatic (chroma below the noise floor), the result inherits
 * the chromatic side's hue so we don't introduce phantom tints when
 * mixing with white/black.
 */
function oklchLerp(a: Oklch, b: Oklch, t: number): Oklch {
  const tt = Math.max(0, Math.min(1, t));
  const aAchromatic = a.c < 0.005;
  const bAchromatic = b.c < 0.005;

  let h: number;
  if (aAchromatic && bAchromatic) {
    h = 0;
  } else if (aAchromatic) {
    h = b.h;
  } else if (bAchromatic) {
    h = a.h;
  } else {
    // Shortest arc.
    const diff = ((b.h - a.h + 540) % 360) - 180;
    h = (a.h + diff * tt + 360) % 360;
  }

  return {
    l: a.l * (1 - tt) + b.l * tt,
    c: a.c * (1 - tt) + b.c * tt,
    h,
  };
}

// ============================================================================
// MATERIALIZATION
// ============================================================================

/**
 * Resolve a (surface, mode) cell's fg behaviour to a concrete
 * (polarity, fg-anchor) pair. Polarity and anchor used to be authored
 * separately; the new `fgByMode` collapses them into one user choice.
 *
 * Falls back to the legacy `polarityByMode` + `fgAnchorByMode` fields
 * for rows authored before the merge.
 */
function resolveFgFor(
  surface: SurfaceRow,
  mode: string,
  surfaceL: number,
  threshold: number,
  resolveBaseHex: (id: TokenRef, mode?: string) => string | null
): { surfaceIsDark: boolean; cellAnchorHex: string | null } {
  const choice = surface.fgByMode?.[mode];

  if (choice) {
    if (choice.kind === "auto") {
      return { surfaceIsDark: surfaceL < threshold, cellAnchorHex: null };
    }
    if (choice.kind === "light") {
      // Light fg = white anchor, surface treated as dark.
      return { surfaceIsDark: true, cellAnchorHex: "#ffffff" };
    }
    if (choice.kind === "dark") {
      return { surfaceIsDark: false, cellAnchorHex: "#000000" };
    }
    // alias / tailwind — polarity follows the color's luminance.
    const hex =
      choice.kind === "tailwind"
        ? getTailwindHex(choice.color)
        : resolveBaseHex(choice.token, mode);
    if (!hex) {
      return { surfaceIsDark: surfaceL < threshold, cellAnchorHex: null };
    }
    const tokenOklch = hexToOklch(hex);
    // A light token implies a light fg → surface treated as dark.
    return {
      surfaceIsDark: tokenOklch.l > threshold,
      cellAnchorHex: hex,
    };
  }

  // Legacy: derive from old polarityByMode + fgAnchorByMode.
  const polarityOverride = surface.polarityByMode?.[mode] ?? "auto";
  const surfaceIsDark =
    polarityOverride === "auto"
      ? surfaceL < threshold
      : polarityOverride === "dark";

  let cellAnchorHex: string | null = null;
  const legacyAnchor = surface.fgAnchorByMode?.[mode];
  if (legacyAnchor && legacyAnchor.kind !== "auto") {
    if (legacyAnchor.kind === "raw") cellAnchorHex = legacyAnchor.value;
    else if (legacyAnchor.kind === "alias") {
      cellAnchorHex = resolveBaseHex(legacyAnchor.token, mode);
    }
  }

  return { surfaceIsDark, cellAnchorHex };
}

/**
 * Resolve a level branch's anchor to a hex.
 *
 * Precedence (most specific wins):
 *   1. branch.anchor `raw` / `alias` — explicit per-level override
 *   2. cellAnchorHex                 — per-(surface, mode) override (from fgByMode)
 *   3. polarity-driven black/white   — pure-contrast fallback
 */
function resolveAnchorHex(
  branchAnchor: SurfaceLevelAnchor,
  cellAnchorHex: string | null,
  surfaceIsDark: boolean,
  resolveBaseHex: (id: TokenRef, mode?: string) => string | null,
  mode?: string,
  surfaceBaseHex?: string
): string {
  if (branchAnchor.kind === "raw") return branchAnchor.value;
  if (branchAnchor.kind === "surface" && surfaceBaseHex) return surfaceBaseHex;
  if (branchAnchor.kind === "tailwind") {
    const hex = getTailwindHex(branchAnchor.color);
    if (hex) return hex;
  }
  if (branchAnchor.kind === "alias") {
    const hex = resolveBaseHex(branchAnchor.token, mode);
    if (hex) return hex;
  }
  if (cellAnchorHex) return cellAnchorHex;
  return surfaceIsDark ? "#ffffff" : "#000000";
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Map signed step strength → OKLCH ΔL, respecting surface polarity and
 * available perceptual headroom near the extremes.
 *
 *   step > 0 → AWAY from polarity (lighter on dark surfaces, darker on
 *              light). The natural "hover lifts" sense.
 *   step < 0 → INTO polarity (deeper).
 *
 * Headroom scaling: the achievable ΔL is bounded by the distance from
 * the surface's lightness to the relevant edge (0 or 1). A `step=+0.4`
 * on a #222 surface and on a #f5f5f5 surface produces visually
 * comparable jumps because each consumes the same fraction of the
 * available headroom in their respective direction.
 *
 * The 0.6 ceiling caps how much of the headroom a max step can consume
 * — prevents `step=±1` from collapsing into pure black/white.
 */
function stepStrengthToDeltaL(
  step: number,
  surfaceL: number,
  surfaceIsDark: boolean
): number {
  const direction = surfaceIsDark ? +1 : -1;
  const movingAwayFromPolarity = step >= 0;
  const headroom = movingAwayFromPolarity
    ? surfaceIsDark
      ? 1 - surfaceL
      : surfaceL
    : surfaceIsDark
      ? surfaceL
      : 1 - surfaceL;
  return direction * step * headroom * 0.6;
}

/**
 * Apply an opacity-kind level to its source color. Used for
 * "disabled" tokens that fade the surface or fg toward a neutral
 * background.
 *
 * Since the Figma bake can't carry transparency, we composite the
 * source over the surface (the visual context where the alpha would
 * appear). That gives Figma a solid color that matches what the CSS
 * `rgb(from var(--surface) r g b / α)` form produces at render time
 * in the same context. Approximate but close.
 *
 * For "surface" source: source = surface itself → the bake is just
 * surface mixed with surface = surface. That's a no-op visually
 * because the alpha layer over its own background reveals the same
 * color. To make the disabled-bg visually distinct, callers should
 * choose the `fg` source for "disabled text" use cases and use a
 * separate `surface-shift` level for "disabled background" if a
 * visible shift is desired.
 */
function applyOpacity(
  surfaceOklch: Oklch,
  sourceHex: string,
  alpha: number
): Oklch {
  const clamped = Math.max(0, Math.min(1, alpha));
  // Background to composite over for the Figma bake: the surface
  // itself. Standard "src-over" with the source at α and the
  // background at (1 - α). In OKLCH lerp terms: lerp from background
  // toward source by α.
  return oklchLerp(surfaceOklch, hexToOklch(sourceHex), clamped);
}

/**
 * Apply a surface-shift branch to a surface's OKLCH. Used by levels
 * with `rule.kind === "surface-shift"` for hover/active/disabled-bg
 * state variants.
 *
 * `stepStrength` (preferred) is mapped to a polarity-aware, headroom-
 * scaled ΔL. Legacy branches with explicit `lightnessDelta` fall
 * through unchanged.
 */
function applySurfaceShift(
  surfaceOklch: Oklch,
  branch: SurfaceShiftBranch,
  surfaceIsDark: boolean,
  resolveBaseHex: (id: TokenRef, mode?: string) => string | null,
  mode?: string
): Oklch {
  const deltaL =
    typeof branch.stepStrength === "number"
      ? stepStrengthToDeltaL(
          branch.stepStrength,
          surfaceOklch.l,
          surfaceIsDark
        )
      : (branch.lightnessDelta ?? 0);

  const l = clamp01(surfaceOklch.l + deltaL);
  const c = Math.max(0, surfaceOklch.c + (branch.chromaDelta ?? 0));
  let shifted: Oklch = { l, c, h: surfaceOklch.h };

  if (branch.mixWith) {
    const hex =
      "tailwind" in branch.mixWith
        ? getTailwindHex(branch.mixWith.tailwind)
        : resolveBaseHex(branch.mixWith.token, mode);
    if (hex) {
      shifted = oklchLerp(shifted, hexToOklch(hex), branch.mixWith.weight);
    }
  }
  return shifted;
}

/**
 * Compute one cell: surface × level × mode → hex. Exported so the
 * preview pane can render a hypothetical level on a surface that
 * doesn't actually emit that level as a token (e.g. base-only
 * surfaces using the default fg levels for visual reference).
 */
export function computeCellHex(
  surface: SurfaceRow,
  level: SurfaceLevel,
  mode: string,
  threshold: number,
  resolveBaseHex: (id: TokenRef, mode?: string) => string | null,
  /**
   * - `allLevels` + `visited`: sibling levels + a cycle-guard, so a fg
   *   level's `measureAgainst: { kind: "level" }` can resolve another
   *   level's computed hex on the same (surface, mode).
   * - `primaryMode`: the first column / source mode. When provided, the
   *   per-mode branch is selected by MODE (primary → onLight, others →
   *   onDark) rather than by surface brightness — so the light column
   *   drives light-mode tokens for every surface, colored or not. The
   *   contrast direction and anchor still adapt to each surface's actual
   *   brightness. Omitted → legacy polarity selection.
   */
  opts?: {
    allLevels?: SurfaceLevel[];
    visited?: Set<string>;
    primaryMode?: string;
    /**
     * Page-background hex for this mode (the `bg` surface base). Used to
     * flatten a translucent `measureAgainst` backdrop so fg contrast is
     * solved against the tint as it actually renders on the page.
     */
    pageBgHex?: string;
    /** Resolver for `scale-step` levels (see `makeResolveScaleStep`). */
    resolveScaleStep?: ResolveScaleStep;
  }
): string | null {
  const base = surface.baseByMode[mode];
  if (!base) return null;

  // 1. Resolve the surface's base hex.
  const baseHex =
    resolveSurfaceBaseHex(base, mode, resolveBaseHex);
  if (!baseHex) return null;

  const surfaceOklch = hexToOklch(baseHex);

  // 2. Resolve fg (polarity + cell anchor) — used for both fg levels
  // (which lerp toward the anchor) and surface-shift levels (which
  // use polarity to pick a branch).
  const { surfaceIsDark, cellAnchorHex } = resolveFgFor(
    surface,
    mode,
    surfaceOklch.l,
    threshold,
    resolveBaseHex
  );

  // Pick the per-mode branch by MODE when a primaryMode is supplied
  // (the light column drives the primary mode for every surface);
  // otherwise fall back to legacy brightness-based selection.
  const usePrimaryBranch =
    opts?.primaryMode !== undefined ? mode === opts.primaryMode : !surfaceIsDark;

  // 3. Dispatch on the rule kind.
  if (level.rule.kind === "surface-shift") {
    const branch = usePrimaryBranch ? level.rule.onLight : level.rule.onDark;
    const shifted = applySurfaceShift(
      surfaceOklch,
      branch,
      surfaceIsDark,
      resolveBaseHex,
      mode
    );
    return oklchToHex(shifted.l, shifted.c, shifted.h);
  }

  if (level.rule.kind === "scale-step") {
    // Resolve a specific step of the source scale. The scale comes from
    // the rule's explicit override, else the surface's own base token
    // (its parent scale). Falls back to the surface base if the source
    // isn't a scale token or the step doesn't exist.
    const branch = usePrimaryBranch ? level.rule.onLight : level.rule.onDark;
    const baseVal = surface.baseByMode[mode];
    // Tailwind families are scales too: an explicit tailwind scale, or a
    // parent scale when the surface base is (derived from) a tailwind
    // color, resolves "<family>-<step>" from the static palette.
    const twFamily =
      branch.scale?.kind === "tailwind"
        ? branch.scale.family
        : (!branch.scale || branch.scale.kind === "parent") &&
            baseVal?.kind === "derived" &&
            baseVal.base.kind === "tailwind"
          ? tailwindFamilyOf(baseVal.base.color)
          : null;
    if (twFamily) {
      const hex = getTailwindHex(`${twFamily}-${branch.step}`);
      return hex ? normalizeToHex(hex) ?? baseHex : baseHex;
    }
    const sourceTokenId =
      branch.scale?.kind === "alias"
        ? branch.scale.token
        : baseVal?.kind === "alias"
          ? baseVal.token
          : null;
    if (sourceTokenId && opts?.resolveScaleStep) {
      const hex = opts.resolveScaleStep(sourceTokenId, branch.step, mode);
      if (hex) return normalizeToHex(hex) ?? baseHex;
    }
    return baseHex;
  }

  if (level.rule.kind === "surface-mix") {
    // Pure mix toward the cell's resolved fg/ink — no L/C shift. The
    // anchor resolves via the same path fg levels use (auto = cell
    // ink, or an explicit alias/raw override).
    const branch = usePrimaryBranch ? level.rule.onLight : level.rule.onDark;
    const anchorHex = resolveAnchorHex(
      branch.anchor,
      cellAnchorHex,
      surfaceIsDark,
      resolveBaseHex,
      mode,
      baseHex
    );
    const result = oklchLerp(surfaceOklch, hexToOklch(anchorHex), branch.mix);
    return oklchToHex(result.l, result.c, result.h);
  }

  if (level.rule.kind === "opacity") {
    const branch = usePrimaryBranch ? level.rule.onLight : level.rule.onDark;
    const src = level.rule.source;
    // Resolve the color the alpha fades: the surface, the cell's fg/ink
    // (via the same anchor path fg rules use), or an explicit token.
    const sourceHex =
      src === "surface"
        ? baseHex
        : src === "fg"
          ? resolveAnchorHex(
              { kind: "auto" },
              cellAnchorHex,
              surfaceIsDark,
              resolveBaseHex,
              mode
            )
          : src.kind === "tailwind"
            ? getTailwindHex(src.color) ?? baseHex
            : resolveBaseHex(src.token, mode) ?? baseHex;
    if (level.rule.bake === "alpha") {
      // True opacity: ship the source color at α as a translucent hex.
      return withAlpha(sourceHex, branch.alpha);
    }
    // Legacy: flatten the faded source over the surface into an opaque hex.
    const composited = applyOpacity(surfaceOklch, sourceHex, branch.alpha);
    return oklchToHex(composited.l, composited.c, composited.h);
  }

  // 4. fg rule — resolve anchor, then dispatch on the branch target.
  const fgBranch = usePrimaryBranch ? level.rule.onLight : level.rule.onDark;
  // Defensive — branch may be the absolute-OKLCH legacy shape (no
  // mix/target/anchor). Bail to a pure anchor pick; the editor's
  // migration replaces this on next mount.
  if (
    !fgBranch ||
    typeof fgBranch !== "object" ||
    (!("mix" in fgBranch) && !("target" in fgBranch))
  ) {
    return surfaceIsDark ? "#ffffff" : "#000000";
  }
  const target = normalizeFgTarget(fgBranch);

  // Resolve the contrast backdrop (default = the surface's own base).
  const measureRef = getMeasureAgainst(fgBranch);
  const measureHex = resolveMeasureBackdropHex(
    measureRef,
    surface,
    level.id,
    mode,
    baseHex,
    threshold,
    resolveBaseHex,
    opts?.allLevels,
    opts?.visited,
    opts?.primaryMode,
    opts?.pageBgHex,
    opts?.resolveScaleStep
  );

  // Anchor (mix direction). For an `auto` anchor measured against a
  // NON-surface backdrop (a sibling level / token — e.g. text on a
  // pale `subtle` tint), take the black/white direction from the
  // BACKDROP's polarity, not the surface's. So text auto-darkens on a
  // light tint and auto-lightens on a dark one. Everything else keeps
  // the surface-polarity behaviour.
  const anchorHex =
    fgBranch.anchor.kind === "auto" &&
    measureRef &&
    measureRef.kind !== "surface"
      ? hexToOklch(measureHex).l < threshold
        ? "#ffffff"
        : "#000000"
      : resolveAnchorHex(
          fgBranch.anchor,
          cellAnchorHex,
          surfaceIsDark,
          resolveBaseHex,
          mode,
          baseHex
        );

  if (target.kind === "apca") {
    return solveForApcaLc({
      surfaceHex: baseHex,
      anchorHex,
      targetLc: target.lc,
      measureAgainstHex: measureHex,
    });
  }
  const anchorOklch = hexToOklch(anchorHex);
  const result = oklchLerp(surfaceOklch, anchorOklch, target.mix);
  return oklchToHex(result.l, result.c, result.h);
}

/**
 * Resolve the backdrop hex a fg APCA target is measured against.
 * Default (no ref or `kind: "surface"`) is the surface's own base.
 * A `level` ref computes that sibling level's hex on the same
 * (surface, mode) — with a cycle guard. An `alias` ref resolves a
 * token. Any failure falls back to the surface base.
 */
export function resolveMeasureBackdropHex(
  ref: SurfaceMeasureRef | undefined,
  surface: SurfaceRow,
  selfLevelId: string,
  mode: string,
  baseHex: string,
  threshold: number,
  resolveBaseHex: (id: TokenRef, mode?: string) => string | null,
  allLevels?: SurfaceLevel[],
  visited?: Set<string>,
  primaryMode?: string,
  /**
   * The page-background hex for this mode (the `bg` surface's base). When
   * the resolved backdrop is translucent (a true-alpha level), it's
   * flattened onto this so contrast is measured against the tint as it
   * actually renders on the page. Falls back to the surface base.
   */
  pageBgHex?: string,
  /** Resolver for `scale-step` backdrop levels (see makeResolveScaleStep). */
  resolveScaleStep?: ResolveScaleStep
): string {
  // Flatten a translucent backdrop onto the page bg (or surface base) so
  // the contrast solver sees the real, opaque rendered color.
  const flatten = (hex: string): string =>
    compositeTranslucentOver(hex, pageBgHex ?? baseHex);

  if (!ref || ref.kind === "surface") return baseHex;
  if (ref.kind === "tailwind") {
    return flatten(getTailwindHex(ref.color) ?? baseHex);
  }
  if (ref.kind === "alias") {
    return flatten(resolveBaseHex(ref.token, mode) ?? baseHex);
  }
  // ref.kind === "level"
  if (!allLevels) return baseHex;
  const seen = visited ?? new Set<string>();
  if (seen.has(ref.levelId) || ref.levelId === selfLevelId) return baseHex;
  const refLevel = allLevels.find((l) => l.id === ref.levelId);
  if (!refLevel) return baseHex;
  const effRule = effectiveLevelRule(surface, refLevel);
  if (!effRule) return baseHex; // disabled for this surface
  const hex = computeCellHex(
    surface,
    { ...refLevel, rule: effRule },
    mode,
    threshold,
    resolveBaseHex,
    {
      allLevels,
      visited: new Set([...seen, selfLevelId, ref.levelId]),
      primaryMode,
      pageBgHex,
      resolveScaleStep,
    }
  );
  return hex ? flatten(hex) : baseHex;
}

// ============================================================================
// RULE DESCRIPTORS — for publish-time $extensions emission.
// ============================================================================

function serializeAnchor(
  anchor: SurfaceLevelAnchor,
  aliasName?: (id: TokenRef) => string | null
): SerializedAnchor {
  if (anchor.kind === "alias") {
    const name = aliasName?.(anchor.token);
    return { kind: "alias", tokenName: name ?? String(anchor.token) };
  }
  return anchor;
}

/**
 * Serialize a per-mode branch into a JSON-friendly descriptor. Alias
 * references (anchor, mixWith) are rewritten to DTCG dotted names via
 * `aliasName` when supplied. Used by the export to populate
 * `$extensions.com.designsystembuilder.generatedFrom.rule`.
 */
export function describeLevelRule(
  level: SurfaceLevel,
  branch:
    | SurfaceLevelBranch
    | SurfaceShiftBranch
    | SurfaceMixBranch
    | SurfaceOpacityBranch
    | SurfaceScaleStepBranch,
  opts: {
    aliasName?: (id: TokenRef) => string | null;
    levelName?: (id: string) => string | null;
  } = {}
): SerializedRule {
  if (level.rule.kind === "scale-step") {
    const ss = branch as SurfaceScaleStepBranch;
    return {
      kind: "scale-step",
      step: ss.step,
      scale:
        ss.scale?.kind === "alias"
          ? {
              kind: "alias",
              tokenName:
                opts.aliasName?.(ss.scale.token) ?? String(ss.scale.token),
            }
          : ss.scale?.kind === "tailwind"
            ? { kind: "tailwind", family: ss.scale.family }
            : "parent",
    };
  }
  if (level.rule.kind === "surface-mix") {
    const mb = branch as SurfaceMixBranch;
    return {
      kind: "surface-mix",
      mix: mb.mix,
      anchor: serializeAnchor(mb.anchor, opts.aliasName),
    };
  }
  if (level.rule.kind === "surface-shift") {
    const shift = branch as SurfaceShiftBranch;
    const out: SerializedRule = { kind: "surface-shift" };
    if (typeof shift.stepStrength === "number") out.stepStrength = shift.stepStrength;
    if (typeof shift.lightnessDelta === "number")
      out.lightnessDelta = shift.lightnessDelta;
    if (typeof shift.chromaDelta === "number") out.chromaDelta = shift.chromaDelta;
    if (shift.mixWith) {
      if ("tailwind" in shift.mixWith) {
        out.mixWith = {
          tailwind: shift.mixWith.tailwind,
          weight: shift.mixWith.weight,
        };
      } else {
        const name = opts.aliasName?.(shift.mixWith.token);
        out.mixWith = {
          tokenName: name ?? String(shift.mixWith.token),
          weight: shift.mixWith.weight,
        };
      }
    }
    return out;
  }
  if (level.rule.kind === "opacity") {
    const opacity = branch as SurfaceOpacityBranch;
    const src = level.rule.source;
    return {
      kind: "opacity",
      source:
        typeof src === "string"
          ? src
          : src.kind === "tailwind"
            ? { kind: "tailwind", color: src.color }
            : {
                kind: "alias",
                tokenName: opts.aliasName?.(src.token) ?? String(src.token),
              },
      alpha: opacity.alpha,
      ...(level.rule.bake ? { bake: level.rule.bake } : {}),
    };
  }
  const fgBranch = branch as SurfaceLevelBranch;
  const out: SerializedRule = {
    kind: "fg",
    target: normalizeFgTarget(fgBranch),
    anchor: serializeAnchor(fgBranch.anchor, opts.aliasName),
  };
  const measureRef = getMeasureAgainst(fgBranch);
  if (measureRef) {
    if (measureRef.kind === "surface") {
      out.measureAgainst = { kind: "surface" };
    } else if (measureRef.kind === "level") {
      out.measureAgainst = {
        kind: "level",
        level: opts.levelName?.(measureRef.levelId) ?? measureRef.levelId,
      };
    } else if (measureRef.kind === "tailwind") {
      out.measureAgainst = { kind: "tailwind", color: measureRef.color };
    } else {
      out.measureAgainst = {
        kind: "alias",
        tokenName:
          opts.aliasName?.(measureRef.token) ?? String(measureRef.token),
      };
    }
  }
  return out;
}

/** Format a signed number with a fixed precision, trimming trailing zeros. */
function formatDelta(n: number, digits = 4): string {
  // Math.abs keeps the sign out of the number; the caller emits "+" / "-".
  return Math.abs(n)
    .toFixed(digits)
    .replace(/\.?0+$/, "")
    .replace(/^$/, "0");
}

function formatPercent(pct: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  return clamped
    .toFixed(4)
    .replace(/\.?0+$/, "")
    .replace(/^$/, "0");
}

/**
 * Build a CSS relative-color expression equivalent to the rule for a
 * given per-mode branch. Returns null when the rule has no closed
 * form (APCA targets) or when an alias reference can't be resolved.
 *
 * For `surface-shift` rules, `appliedDeltaL` is the headroom-resolved
 * ΔL the materializer used for the cell. Baking it in keeps the CSS
 * expression simple and matches the resolved hex exactly.
 */
export function expressLevelAsCss(
  level: SurfaceLevel,
  branch:
    | SurfaceLevelBranch
    | SurfaceShiftBranch
    | SurfaceMixBranch
    | SurfaceOpacityBranch
    | SurfaceScaleStepBranch,
  opts: {
    surfaceVar: string;
    /**
     * When set, an `auto` fg anchor is rendered as `var(<this>)`
     * instead of giving up. Lets the consumer wire `--fg` per scope
     * and have ONE generic mix-target rule cover every surface.
     */
    fgVar?: string;
    aliasName?: (id: TokenRef) => string | null;
    appliedDeltaL?: number;
  }
): string | null {
  const surfaceExpr = `var(${opts.surfaceVar})`;

  // scale-step resolves to a concrete existing scale token; the
  // materialized hex IS the value, and there's no per-mode relative-color
  // form, so emit no css hint (the descriptor still records the rule).
  if (level.rule.kind === "scale-step") return null;

  if (level.rule.kind === "surface-mix") {
    const mb = branch as SurfaceMixBranch;
    // Resolve the ink anchor. `auto` needs `--fg` wired by the
    // consumer (the generic surface-utility pattern); without it the
    // mix toward the cell's polarity-dependent ink has no single
    // closed form, so we bail.
    let anchorExpr: string;
    if (mb.anchor.kind === "raw") {
      anchorExpr = mb.anchor.value;
    } else if (mb.anchor.kind === "surface") {
      anchorExpr = surfaceExpr;
    } else if (mb.anchor.kind === "tailwind") {
      anchorExpr = `var(--color-${mb.anchor.color})`;
    } else if (mb.anchor.kind === "alias") {
      const name = opts.aliasName?.(mb.anchor.token);
      if (!name) return null;
      anchorExpr = `var(--${name.replace(/\./g, "-")})`;
    } else if (opts.fgVar) {
      anchorExpr = `var(${opts.fgVar})`;
    } else {
      return null;
    }
    const t = Math.max(0, Math.min(1, mb.mix));
    if (t >= 1) return anchorExpr;
    const surfacePct = formatPercent((1 - t) * 100);
    const anchorPct = formatPercent(t * 100);
    return `color-mix(in oklch, ${surfaceExpr} ${surfacePct}%, ${anchorExpr} ${anchorPct}%)`;
  }

  if (level.rule.kind === "opacity") {
    const op = branch as SurfaceOpacityBranch;
    const alpha = Math.max(0, Math.min(1, op.alpha));
    const src = level.rule.source;
    let sourceExpr: string | null;
    if (src === "surface") {
      sourceExpr = surfaceExpr;
    } else if (src === "fg") {
      sourceExpr = opts.fgVar ? `var(${opts.fgVar})` : null;
    } else if (src.kind === "tailwind") {
      sourceExpr = `var(--color-${src.color})`;
    } else {
      const name = opts.aliasName?.(src.token);
      sourceExpr = name ? `var(--${name.replace(/\./g, "-")})` : null;
    }
    if (!sourceExpr) return null;
    // `rgb(from <src> r g b / α)` is the cleanest way to express
    // "this color at α alpha." Browsers with relative-color support
    // accept this for any source color (including oklch/var refs).
    return `rgb(from ${sourceExpr} r g b / ${alpha})`;
  }

  if (level.rule.kind === "surface-shift") {
    const shift = branch as SurfaceShiftBranch;
    const dl = opts.appliedDeltaL ?? shift.lightnessDelta ?? 0;
    const dc = shift.chromaDelta ?? 0;
    const lPart =
      dl === 0
        ? "l"
        : `calc(l ${dl > 0 ? "+" : "-"} ${formatDelta(dl)})`;
    const cPart =
      dc === 0
        ? "c"
        : `calc(c ${dc > 0 ? "+" : "-"} ${formatDelta(dc, 5)})`;
    let expr = `oklch(from ${surfaceExpr} ${lPart} ${cPart} h)`;

    if (shift.mixWith) {
      let otherExpr: string;
      if ("tailwind" in shift.mixWith) {
        otherExpr = `var(--color-${shift.mixWith.tailwind})`;
      } else {
        const aliasName = opts.aliasName?.(shift.mixWith.token);
        if (!aliasName) return null;
        otherExpr = `var(--${aliasName.replace(/\./g, "-")})`;
      }
      const w = Math.max(0, Math.min(1, shift.mixWith.weight));
      const basePct = formatPercent((1 - w) * 100);
      const otherPct = formatPercent(w * 100);
      expr = `color-mix(in oklch, ${expr} ${basePct}%, ${otherExpr} ${otherPct}%)`;
    }
    return expr;
  }

  const fgBranch = branch as SurfaceLevelBranch;
  const target = normalizeFgTarget(fgBranch);

  // Resolve the anchor first — same for both mix and APCA targets.
  // Auto anchors need a polarity-aware concrete color, which isn't
  // expressible in a single CSS expression — UNLESS the consumer
  // wires `--fg` per scope (the surface utility class pattern), in
  // which case `auto` becomes `var(--fg)` and ONE expression covers
  // every surface.
  let anchorExpr: string;
  if (fgBranch.anchor.kind === "raw") {
    anchorExpr = fgBranch.anchor.value;
  } else if (fgBranch.anchor.kind === "surface") {
    anchorExpr = surfaceExpr;
  } else if (fgBranch.anchor.kind === "tailwind") {
    anchorExpr = `var(--color-${fgBranch.anchor.color})`;
  } else if (fgBranch.anchor.kind === "alias") {
    const name = opts.aliasName?.(fgBranch.anchor.token);
    if (!name) return null;
    anchorExpr = `var(--${name.replace(/\./g, "-")})`;
  } else if (opts.fgVar) {
    anchorExpr = `var(${opts.fgVar})`;
  } else {
    return null;
  }

  // For APCA targets there's no closed-form CSS. Approximate as a
  // mix percentage proportional to the Lc target — visually close
  // for body text and muted variants. The per-surface bake in
  // $value stays contrast-correct for consumers that need it.
  if (target.kind === "apca") {
    const lc = Math.max(0, Math.min(108, target.lc));
    if (lc >= 95) return anchorExpr;            // pure contrast
    const t = lc / 100;
    const surfacePct = formatPercent((1 - t) * 100);
    const anchorPct = formatPercent(t * 100);
    return `color-mix(in oklch, ${surfaceExpr} ${surfacePct}%, ${anchorExpr} ${anchorPct}%)`;
  }

  const t = Math.max(0, Math.min(1, target.mix));
  if (t >= 1) return anchorExpr;                // pure contrast shortcut
  const surfacePct = formatPercent((1 - t) * 100);
  const anchorPct = formatPercent(t * 100);
  return `color-mix(in oklch, ${surfaceExpr} ${surfacePct}%, ${anchorExpr} ${anchorPct}%)`;
}

/**
 * Build per-level GENERIC CSS expressions, using `var(--surface)` and
 * `var(--fg)` as placeholders. One entry per (level, mode) where the
 * rule has a closed-form CSS equivalent (APCA fg targets and
 * `auto`-anchored mix rules without an `--fg` wire-up are skipped).
 *
 * Consumers can `:root { --fg-muted: <expr>; }` once and have every
 * scope's `--surface` / `--fg` pair feed the cascade — no per-surface
 * level tokens needed in the consumer's CSS. Figma keeps using the
 * per-surface bakes from `generateSurfaceTokens`.
 *
 * The expression is built off the `onLight` / `onDark` branch of each
 * level rule — both modes get their own entry. `stepStrength` is NOT
 * pre-resolved to a per-surface ΔL here (we don't have a specific
 * surface in scope); we use the literal `stepStrength * 0.6` as an
 * approximation, which matches the materializer's max-headroom case.
 * In practice the difference is small for typical step values.
 */
export type LevelRuleEntry =
  | { css: string; rule: SerializedRule }
  | {
      onLightSurface: string;
      onDarkSurface: string;
      rule: SerializedRule;
    };

export function expressLevelRulesGeneric(
  config: SurfacesConfig,
  opts: {
    surfaceVar?: string;
    fgVar?: string;
    aliasName?: (id: TokenRef) => string | null;
  } = {}
): Record<string, LevelRuleEntry> {
  const surfaceVar = opts.surfaceVar ?? "--surface";
  const fgVar = opts.fgVar ?? "--fg";
  const out: Record<string, LevelRuleEntry> = {};

  for (const level of config.levels) {
    if (!level.name.trim()) continue;

    // Build expressions for BOTH surface-polarity branches. The
    // materializer picks branch by surface polarity at runtime
    // (light surface → onLight, dark surface → onDark). Consumers
    // need both options exposed so a surface utility class can
    // wire the right one based on its declared polarity.
    const buildBranch = (
      branch:
        | SurfaceLevelBranch
        | SurfaceShiftBranch
        | SurfaceOpacityBranch
        | SurfaceScaleStepBranch,
      surfaceIsDark: boolean
    ) => {
      let appliedDeltaL: number | undefined;
      if (level.rule.kind === "surface-shift") {
        const shift = branch as SurfaceShiftBranch;
        if (typeof shift.stepStrength === "number") {
          // Direction flips by polarity (the materializer's
          // headroom-aware curve, simplified to the max-headroom
          // case for the generic expression).
          const direction = surfaceIsDark ? +1 : -1;
          appliedDeltaL = direction * shift.stepStrength * 0.6;
        } else if (typeof shift.lightnessDelta === "number") {
          appliedDeltaL = shift.lightnessDelta;
        }
      }
      return expressLevelAsCss(level, branch, {
        surfaceVar,
        fgVar,
        aliasName: opts.aliasName,
        appliedDeltaL,
      });
    };

    const onLightCss = buildBranch(level.rule.onLight, false);
    const onDarkCss = buildBranch(level.rule.onDark, true);
    if (!onLightCss && !onDarkCss) continue;

    // Use the onLight branch to serialize the rule descriptor. The
    // rule is a single structured form regardless of polarity; we
    // emit it once per level alongside the expressions.
    const rule = describeLevelRule(level, level.rule.onLight, {
      aliasName: opts.aliasName,
    });

    if (onLightCss && onDarkCss) {
      if (onLightCss === onDarkCss) {
        out[level.name] = { css: onLightCss, rule };
      } else {
        out[level.name] = {
          onLightSurface: onLightCss,
          onDarkSurface: onDarkCss,
          rule,
        };
      }
    } else if (onLightCss) {
      out[level.name] = { css: onLightCss, rule };
    } else if (onDarkCss) {
      out[level.name] = { css: onDarkCss, rule };
    }
  }

  return out;
}

/**
 * The "primary" mode whose base/fg values other modes inherit when
 * left unset — the first column in the surfaces table.
 */
export function primaryMode(modes: string[]): string | undefined {
  return modes[0];
}

/**
 * Mode used to key per-mode branch selection (primary → onLight, others
 * → onDark), or `undefined` to fall back to legacy polarity selection.
 *
 * Mode-keying only makes sense with the binary onLight/onDark model when
 * there are at most two modes. With 3+ modes the second column would
 * have to cover every non-primary mode, so we keep brightness/polarity
 * selection instead — and, importantly, leave those configs' existing
 * token values unchanged.
 */
export function modeKeyPrimary(modes: string[]): string | undefined {
  return modes.length <= 2 ? modes[0] : undefined;
}

/**
 * Return a copy of the surface with each non-primary mode's base and
 * fg resolved through first-mode inheritance, so downstream
 * materialization can read `baseByMode[mode]` / `fgByMode[mode]`
 * directly. A mode with no explicit base (or fg) inherits the primary
 * mode's value. Returns the original reference unchanged when nothing
 * needs filling (cheap no-op for fully-explicit surfaces).
 */
export function expandSurfaceModes(
  surface: SurfaceRow,
  modes: string[]
): SurfaceRow {
  const first = modes[0];
  if (!first) return surface;
  const baseByMode = { ...surface.baseByMode };
  const fgByMode = { ...(surface.fgByMode ?? {}) };
  let changed = false;
  for (const mode of modes) {
    if (mode === first) continue;
    if (!baseByMode[mode] && surface.baseByMode[first]) {
      baseByMode[mode] = surface.baseByMode[first];
      changed = true;
    }
    if (!fgByMode[mode] && surface.fgByMode?.[first]) {
      fgByMode[mode] = surface.fgByMode[first];
      changed = true;
    }
  }
  if (!changed) return surface;
  return { ...surface, baseByMode, fgByMode };
}

/**
 * Resolve the effective rule for a (surface, level) pair:
 *   - explicit `disabled` (or matched by the `"*"` wildcard) → null
 *   - explicit `override`                                    → its rule
 *   - no entry (default)                                     → global rule
 *
 * When `levelStates` is absent the surface predates the 3-state model,
 * so we fall back to the legacy `excludeAllLevels` / `excludeLevels`
 * flags. Returning null means "this surface does not emit this level".
 */
export function effectiveLevelRule(
  surface: SurfaceRow,
  level: SurfaceLevel
): SurfaceLevelRule | null {
  const states = surface.levelStates;
  if (!states) {
    if (surface.excludeAllLevels) return null;
    if (surface.excludeLevels?.includes(level.id)) return null;
    return level.rule;
  }
  const entry = states[level.id] ?? states[WILDCARD_LEVEL_KEY];
  if (!entry) return level.rule;
  if (entry.state === "disabled") return null;
  return level.rule;
}

/**
 * Materialize the full token matrix.
 *
 * One entry per surface × level. `values` keyed by mode with raw hex.
 * Modes where computation fails (missing base, unresolvable alias) are
 * omitted — the token still exists for the modes that did resolve.
 */
export function generateSurfaceTokens(
  config: SurfacesConfig,
  modes: string[],
  resolveBaseHex: (id: TokenRef, mode?: string) => string | null,
  options: MaterializeOptions = {}
): GeneratedSurfaceToken[] {
  const surfaceVar = options.surfaceVar ?? "--surface";
  const aliasName = options.aliasName;
  const threshold = config.contrastThreshold ?? DEFAULT_THRESHOLD;
  const out: GeneratedSurfaceToken[] = [];
  // Dedupe by name (LIFO — later writes win). Covers accidental
  // duplicate names AND legitimate collisions when multiple surfaces
  // are flagged `bareLevels`.
  const seen = new Set<string>();
  const pushDedupe = (
    name: string,
    values: Record<string, { type: "raw"; value: string }>,
    meta?: Record<string, GeneratedFromDescriptor>
  ) => {
    const entry: GeneratedSurfaceToken = meta && Object.keys(meta).length > 0
      ? { name, values, meta }
      : { name, values };
    if (seen.has(name)) {
      const idx = out.findIndex((t) => t.name === name);
      if (idx >= 0) out[idx] = entry;
      return;
    }
    seen.add(name);
    out.push(entry);
  };

  // The page background each translucent tint visually sits on. By
  // convention this is the `bg` surface (else the first surface). Used to
  // flatten true-alpha `measureAgainst` backdrops so fg contrast solves
  // against the tint as actually rendered. Resolved once, per mode.
  const pageBgSurface =
    config.surfaces.find((s) => s.name.trim().toLowerCase() === "bg") ??
    config.surfaces.find((s) =>
      /^(bg|background|base|page|surface|default)$/i.test(s.name.trim())
    ) ??
    config.surfaces[0];
  const pageBgByMode: Record<string, string> = {};
  if (pageBgSurface) {
    const expandedBg = expandSurfaceModes(pageBgSurface, modes);
    for (const mode of modes) {
      const bgBase = expandedBg.baseByMode[mode];
      if (!bgBase) continue;
      const bgHex = resolveSurfaceBaseHex(bgBase, mode, resolveBaseHex);
      if (bgHex) pageBgByMode[mode] = bgHex;
    }
  }

  for (const rawSurface of config.surfaces) {
    if (!rawSurface.name.trim()) continue;
    // Fill non-primary modes from first-mode inheritance so every
    // cell reads a concrete base/fg below.
    const surface = expandSurfaceModes(rawSurface, modes);

    // 1. Optionally emit the surface base as a token. For raw bases
    //    we emit hex; for aliases we still resolve to hex here (the
    //    generated tokens table stores raw values — the alias
    //    relationship is implicit, and primitive changes cascade on
    //    the next regen).
    if (surface.materializeBase) {
      const values: Record<string, { type: "raw"; value: string }> = {};
      for (const mode of modes) {
        const base = surface.baseByMode[mode];
        if (!base) continue;
        const hex =
          resolveSurfaceBaseHex(base, mode, resolveBaseHex);
        if (hex) values[mode] = { type: "raw", value: hex };
      }
      if (Object.keys(values).length > 0) {
        pushDedupe(surface.name, values);
      }
    }

    // 2. Per-surface, per-level state. `effectiveLevelRule` resolves
    //    default (inherit) / override (custom rule) / disabled (skip),
    //    folding in the legacy `excludeLevels` / `excludeAllLevels`
    //    fallback for surfaces that predate `levelStates`.
    for (const level of config.levels) {
      if (!level.name.trim()) continue;
      const rule = effectiveLevelRule(surface, level);
      if (!rule) continue;
      // Synthetic level carrying the effective (possibly overridden)
      // rule. Name/id stay the same; only the rule may diverge.
      const effLevel: SurfaceLevel = { ...level, rule };

      const values: Record<string, { type: "raw"; value: string }> = {};
      const meta: Record<string, GeneratedFromDescriptor> = {};

      for (const mode of modes) {
        const hex = computeCellHex(
          surface,
          effLevel,
          mode,
          threshold,
          resolveBaseHex,
          {
            allLevels: config.levels,
            primaryMode: modeKeyPrimary(modes),
            pageBgHex: pageBgByMode[mode],
            resolveScaleStep: options.resolveScaleStep,
          }
        );
        if (!hex) continue;
        values[mode] = { type: "raw", value: hex };

        // Build the generatedFrom descriptor for this (surface, level,
        // mode) cell. Pick the same branch the materializer used and
        // resolve the headroom-aware ΔL for surface-shift levels.
        const base = surface.baseByMode[mode];
        if (!base) continue;
        const baseHex =
          resolveSurfaceBaseHex(base, mode, resolveBaseHex);
        if (!baseHex) continue;
        const surfaceOklch = hexToOklch(baseHex);
        const { surfaceIsDark } = resolveFgFor(
          surface,
          mode,
          surfaceOklch.l,
          threshold,
          resolveBaseHex
        );
        const branch = surfaceIsDark
          ? effLevel.rule.onDark
          : effLevel.rule.onLight;

        let appliedDeltaL: number | undefined;
        if (effLevel.rule.kind === "surface-shift") {
          const shift = branch as SurfaceShiftBranch;
          if (typeof shift.stepStrength === "number") {
            appliedDeltaL = stepStrengthToDeltaL(
              shift.stepStrength,
              surfaceOklch.l,
              surfaceIsDark
            );
          } else if (typeof shift.lightnessDelta === "number") {
            appliedDeltaL = shift.lightnessDelta;
          }
        }

        const serializedRule = describeLevelRule(effLevel, branch, {
          aliasName,
          levelName: (id) => config.levels.find((l) => l.id === id)?.name ?? null,
        });
        const css = expressLevelAsCss(effLevel, branch, {
          surfaceVar,
          aliasName,
          appliedDeltaL,
        });
        const descriptor: GeneratedFromDescriptor = {
          surface: surface.name,
          level: level.name,
          rule: serializedRule,
        };
        if (css) descriptor.css = css;
        meta[mode] = descriptor;
      }
      if (Object.keys(values).length === 0) continue;

      const name = surface.bareLevels
        ? level.name
        : `${surface.name}.${level.name}`;
      pushDedupe(name, values, meta);
    }
  }

  return out;
}

/**
 * What polarity *would* be picked by auto for (surface, mode). Used by
 * the editor UI to render the "auto → light fg" / "auto → dark fg"
 * hint next to the unified fg picker.
 *
 * Returns "light" if the surface is dark enough that the auto
 * computation would land on a light fg (i.e. surface treated as
 * dark → onDark branch → white anchor), "dark" otherwise.
 */
export function autoFgForCell(
  surface: SurfaceRow,
  mode: string,
  threshold: number,
  resolveBaseHex: (id: TokenRef, mode?: string) => string | null
): "light" | "dark" | null {
  const base = surface.baseByMode[mode];
  if (!base) return null;
  const baseHex =
    resolveSurfaceBaseHex(base, mode, resolveBaseHex);
  if (!baseHex) return null;
  const { l } = hexToOklch(baseHex);
  // Surface is dark → auto chooses LIGHT fg.
  return l < threshold ? "light" : "dark";
}

/** @deprecated Use `autoFgForCell` instead. */
export function autoPolarityForCell(
  surface: SurfaceRow,
  mode: string,
  threshold: number,
  resolveBaseHex: (id: TokenRef, mode?: string) => string | null
): "light" | "dark" | null {
  // Note: this returns the SURFACE polarity, which is opposite of fg
  // polarity. Kept for back-compat with any unmigrated callers.
  const fg = autoFgForCell(surface, mode, threshold, resolveBaseHex);
  if (fg === null) return null;
  return fg === "light" ? "dark" : "light";
}

/**
 * Detect a legacy (pre-mix-rework) config and signal that a full
 * reseed is the simplest migration. Returns true when at least one
 * level branch uses the absolute-OKLCH shape (`l`/`c`/`hueSource`).
 *
 * NOT triggered for the pre-`rule` shape — that one is handled by
 * `migrateLevelsToRuleShape` since it doesn't need a destructive
 * reseed (the data is just structurally wrapped).
 */
export function isLegacySurfacesConfig(config: SurfacesConfig): boolean {
  return config.levels.some((lvl) => {
    const anyLvl = lvl as unknown as AnyLevel;
    // Modern levels have `rule.kind` — trust the discriminator and
    // only inspect branches for the absolute-OKLCH legacy fg shape,
    // which is the ONLY pre-rework shape that needs a destructive
    // reseed. Every current rule kind (`fg`, `surface-shift`,
    // `opacity`) is supported as-is.
    if ("rule" in anyLvl) {
      if (anyLvl.rule.kind !== "fg") return false;
      const onLight = anyLvl.rule.onLight;
      const onDark = anyLvl.rule.onDark;
      const hasFgShape = (b: unknown): boolean =>
        !!b &&
        typeof b === "object" &&
        ("mix" in b || "target" in b) &&
        !!(b as { anchor?: unknown }).anchor;
      return !hasFgShape(onLight) || !hasFgShape(onDark);
    }
    // Pre-`rule` legacy: branches sit inline on the level. Same
    // structural check — only trigger reseed when neither branch has
    // a recognizable fg shape and neither is a surface-shift.
    const onLight = anyLvl.onLight;
    const onDark = anyLvl.onDark;
    if (
      onLight &&
      typeof onLight === "object" &&
      ("lightnessDelta" in onLight || "stepStrength" in onLight)
    ) {
      return false;
    }
    const hasFgShape = (b: unknown): boolean =>
      !!b &&
      typeof b === "object" &&
      ("mix" in b || "target" in b) &&
      !!(b as { anchor?: unknown }).anchor;
    return !hasFgShape(onLight) || !hasFgShape(onDark);
  });
}

/**
 * Lift pre-`rule` levels into the canonical `rule.kind="fg"` shape.
 * Used by the editor on mount to migrate older configs without
 * triggering the destructive reseed path.
 */
export function migrateLevelsToRuleShape(
  config: SurfacesConfig
): SurfacesConfig {
  let changed = false;
  const levels = config.levels.map((lvl) => {
    const wrapped = normalizeLevel(lvl as AnyLevel);
    if (wrapped && wrapped !== (lvl as unknown as SurfaceLevel)) {
      changed = true;
      return wrapped;
    }
    return lvl;
  });
  return changed ? { ...config, levels } : config;
}

/**
 * Map legacy `excludeLevels` / `excludeAllLevels` onto the `levelStates`
 * model. Idempotent: a surface that already carries `levelStates` is
 * left untouched.
 *
 *   - `excludeAllLevels: true` → `levelStates["*"] = { state: "disabled" }`
 *     (the wildcard disables any level without an explicit entry,
 *     preserving the "new levels stay off" guarantee).
 *   - each id in `excludeLevels` → `{ state: "disabled" }`.
 *
 * The legacy fields are dropped from the migrated copy so the two
 * representations don't drift.
 */
export function migrateSurfaceLevelStates(
  config: SurfacesConfig
): SurfacesConfig {
  let changed = false;
  const surfaces = config.surfaces.map((surface) => {
    if (surface.levelStates) return surface;
    if (!surface.excludeAllLevels && !surface.excludeLevels?.length) {
      // Nothing legacy to migrate — leave as default (no levelStates).
      return surface;
    }
    changed = true;
    const levelStates: Record<string, SurfaceLevelOverride> = {};
    if (surface.excludeAllLevels) {
      levelStates[WILDCARD_LEVEL_KEY] = { state: "disabled" };
    } else {
      for (const id of surface.excludeLevels ?? []) {
        levelStates[id] = { state: "disabled" };
      }
    }
    const {
      excludeLevels: _drop1,
      excludeAllLevels: _drop2,
      ...rest
    } = surface;
    void _drop1;
    void _drop2;
    return { ...rest, levelStates };
  });
  return changed ? { ...config, surfaces } : config;
}

/**
 * Strip the removed `clampLc` field from fg branches. Value-preserving:
 * the solver ignores it. Needed because configs saved while the
 * experimental contrast-clamp briefly existed carry a `clampLc` the
 * current code no longer writes — and we want to phase it out of stored
 * data on the next save. Idempotent.
 */
export function stripFgClampLc(config: SurfacesConfig): SurfacesConfig {
  let changed = false;
  const clean = (b: SurfaceLevelBranch): SurfaceLevelBranch => {
    if (!("target" in b) || (b as { clampLc?: unknown }).clampLc === undefined) {
      return b;
    }
    changed = true;
    const { clampLc: _drop, ...rest } = b as SurfaceLevelBranch & {
      clampLc?: unknown;
    };
    void _drop;
    return rest as SurfaceLevelBranch;
  };
  const levels = config.levels.map((lvl) => {
    if (lvl.rule.kind !== "fg") return lvl;
    const onLight = clean(lvl.rule.onLight);
    const onDark = clean(lvl.rule.onDark);
    if (onLight === lvl.rule.onLight && onDark === lvl.rule.onDark) return lvl;
    return { ...lvl, rule: { kind: "fg" as const, onLight, onDark } };
  });
  return changed ? { ...config, levels } : config;
}

// ============================================================================
// SEED — used to bootstrap the editor on first opt-in.
// ============================================================================

/**
 * Sensible default config. One neutral surface, four levels covering
 * the standard fg ramp + a border. All anchors auto so the levels
 * adapt to whatever the surface is.
 */
export function seedSurfacesConfig(modes: string[]): SurfacesConfig {
  const newId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);

  const baseByMode: Record<string, SurfaceBaseValue> = {};
  for (const mode of modes) {
    if (mode === "light") baseByMode[mode] = { kind: "raw", value: "#ffffff" };
    else if (mode === "dark") baseByMode[mode] = { kind: "raw", value: "#0a0a0a" };
    else baseByMode[mode] = { kind: "raw", value: "#fafafa" };
  }

  const auto: SurfaceLevelAnchor = { kind: "auto" };

  const fgLevel = (name: string, lc: number): SurfaceLevel => ({
    id: newId(),
    name,
    rule: {
      kind: "fg",
      onLight: { target: { kind: "apca", lc }, anchor: auto },
      onDark: { target: { kind: "apca", lc }, anchor: auto },
    },
  });

  return {
    contrastThreshold: 0.6,
    surfaces: [
      {
        id: newId(),
        name: "surface",
        baseByMode,
        materializeBase: true,
      },
    ],
    levels: [
      // Mix percentages toward the contrast anchor. Closed-form CSS
      // (`color-mix(in oklch, var(--surface), var(--fg) X%)`) so the
      // helper's published `levelRules` give CSS consumers a clean
      // global rule per slot. APCA targets are still available via
      // the editor's branch UI when contrast-uniformity matters.
      fgLevel("fg", 90),
      fgLevel("fg-muted", 60),
      fgLevel("fg-disabled", 30),
      fgLevel("border", 18),
    ],
  };
}

/**
 * Default surface-shift branch — used when the user adds a new
 * surface-variation level. Slight lightness lift (good starting
 * point for hover); on-light/on-dark are anti-symmetric so the
 * variation behaves naturally regardless of surface polarity.
 */
export function defaultSurfaceShiftLevel(name: string): SurfaceLevel {
  const newId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return {
    id: newId(),
    name,
    rule: {
      kind: "surface-shift",
      // Same signed step on both branches — the materializer flips
      // direction by polarity so authors don't have to.
      onLight: { stepStrength: 0.4 },
      onDark: { stepStrength: 0.4 },
    },
  };
}

/**
 * Default opacity-kind level — used when the user adds a new
 * opacity variant (e.g. "disabled-fg") via the editor. Source
 * defaults to `fg` because disabled-text is the more common
 * authoring intent; alpha 0.4 lands in the "visibly disabled but
 * still legible" range.
 */
export function defaultOpacityLevel(name: string): SurfaceLevel {
  const newId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return {
    id: newId(),
    name,
    rule: {
      kind: "opacity",
      source: "fg",
      // New opacity rules ship true translucency by default.
      bake: "alpha",
      onLight: { alpha: 0.4 },
      onDark: { alpha: 0.4 },
    },
  };
}

/**
 * Default surface-mix level — used when the user adds a new "ink mix"
 * level via the editor. Mixes the surface 60% toward its fg/ink with
 * no L/C shift; both branches auto-anchor to the cell's ink so the
 * mix tracks the surface's polarity. Lower the mix (e.g. 0.04–0.14)
 * for raised cards / fills / borders.
 */
export function defaultSurfaceMixLevel(name: string): SurfaceLevel {
  const newId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return {
    id: newId(),
    name,
    rule: {
      kind: "surface-mix",
      onLight: { mix: 0.6, anchor: { kind: "auto" } },
      onDark: { mix: 0.6, anchor: { kind: "auto" } },
    },
  };
}

/**
 * Default scale-step level — used when the user adds a new "scale step"
 * level via the editor. Draws from the surface's parent scale; step 500
 * is a neutral mid-scale starting point. Both branches identical so it's
 * one step everywhere until the author unlinks them.
 */
export function defaultScaleStepLevel(name: string): SurfaceLevel {
  const newId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return {
    id: newId(),
    name,
    rule: {
      kind: "scale-step",
      onLight: { step: "500", scale: { kind: "parent" } },
      onDark: { step: "500", scale: { kind: "parent" } },
    },
  };
}

/**
 * Default fg level — used when the user adds a new foreground level
 * via the editor.
 */
export function defaultFgLevel(name: string): SurfaceLevel {
  const newId = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return {
    id: newId(),
    name,
    rule: {
      kind: "fg",
      // Contrast-target by default: the solver finds the mix that hits
      // the APCA Lc against the measure backdrop (the surface itself
      // unless `measureAgainst` overrides it). Lc 75 ≈ comfortable body
      // text. Manual mix authoring lives in the `ink-mix` rule.
      onLight: { target: { kind: "apca", lc: 75 }, anchor: { kind: "auto" } },
      onDark: { target: { kind: "apca", lc: 75 }, anchor: { kind: "auto" } },
    },
  };
}
