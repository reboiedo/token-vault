/**
 * OKLCH-space derivation resolver. Computes the static hex for a
 * `derived` token value AND a CSS relative-color expression for
 * `$extensions.css.value`.
 *
 * Ported from the cloud product (web/src/lib/derivation.ts) with
 * name-based references: ops point at tokens by dotted name (TokenRef),
 * not database ids. The `resolve` callback resolves a ref to a hex.
 */

import { converter, formatHex, oklch as oklchFn, parse, interpolate } from "culori";
import type { DerivationBase, DerivationOp, TokenRef } from "./types";
import { getTailwindHex } from "./tailwind-colors";

export type { DerivationBase, DerivationOp };

export interface OklchColor {
  l: number;
  c: number;
  h: number;
  alpha?: number;
}

/** Resolves a token ref (dotted name) to a hex, or null when unknown. */
export type ResolveRefHex = (ref: TokenRef) => string | null;

// ============================================================================
// COLOR PRIMITIVES
// ============================================================================

const toOklchFn = converter("oklch");

export function hexToOklch(hex: string): OklchColor {
  const parsed = parse(hex);
  if (!parsed) return { l: 0, c: 0, h: 0 };
  const o = toOklchFn(parsed);
  return {
    l: o.l ?? 0,
    c: o.c ?? 0,
    h: o.h ?? 0,
    alpha: o.alpha,
  };
}

export function oklchToHex(o: OklchColor): string {
  const c = oklchFn({ mode: "oklch", l: o.l, c: o.c, h: o.h, alpha: o.alpha });
  return formatHex(c) ?? "#000000";
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// ============================================================================
// OPS
// ============================================================================

/**
 * Apply a single op to the running OKLCH color. Returns the next OKLCH.
 *
 * `resolve(ref)` is called for `mix.with` and the two `autoContrast`
 * branches. It must return a hex (callers should resolve derived tokens
 * recursively before passing the function in).
 */
export function applyOp(
  current: OklchColor,
  op: DerivationOp,
  resolve: ResolveRefHex
): OklchColor {
  switch (op.op) {
    case "lighten":
      return { ...current, l: clamp01(current.l + op.amount) };
    case "darken":
      return { ...current, l: clamp01(current.l - op.amount) };
    case "mute":
      return { ...current, c: Math.max(0, current.c * (1 - op.amount)) };
    case "mix": {
      const otherHex = resolve(op.with);
      if (!otherHex) return current;
      const other = hexToOklch(otherHex);
      // Hue-aware lerp: pick shorter arc.
      const lerpHue = (a: number, b: number, t: number) => {
        const diff = ((b - a + 540) % 360) - 180;
        return (a + diff * t + 360) % 360;
      };
      const w = clamp01(op.weight);
      return {
        l: current.l * (1 - w) + other.l * w,
        c: current.c * (1 - w) + other.c * w,
        h: lerpHue(current.h, other.h, w),
      };
    }
    case "autoContrast": {
      const threshold = op.threshold ?? 0.6;
      const useDark = current.l >= threshold;
      const ref = useDark ? op.dark : op.light;
      const fallback = useDark ? "#000000" : "#ffffff";
      const hex = ref ? resolve(ref) ?? fallback : fallback;
      return hexToOklch(hex);
    }
    case "shift": {
      // Mirrors surface-shift's polarity-aware, headroom-scaled ΔL.
      // Polarity = "is the current color dark?" — auto-picked at the
      // standard 0.6 OKLCH-L threshold.
      const surfaceIsDark = current.l < 0.6;
      const direction = surfaceIsDark ? +1 : -1;
      const movingAwayFromPolarity = op.stepStrength >= 0;
      const headroom = movingAwayFromPolarity
        ? surfaceIsDark
          ? 1 - current.l
          : current.l
        : surfaceIsDark
          ? current.l
          : 1 - current.l;
      const deltaL = direction * op.stepStrength * headroom * 0.6;
      return {
        ...current,
        l: clamp01(current.l + deltaL),
        c: Math.max(0, current.c + (op.chromaDelta ?? 0)),
      };
    }
  }
}

// ============================================================================
// RESOLVER
// ============================================================================

/**
 * Resolve a derived value to a static OKLCH color.
 *
 * `resolve` returns the hex for a token ref — when that token is itself
 * derived, the caller must already have walked through it (do a
 * topological pre-pass for batch resolution).
 */
export function resolveDerivation(
  base: DerivationBase,
  ops: DerivationOp[],
  resolve: ResolveRefHex
): OklchColor {
  let current: OklchColor;
  if (base.kind === "raw") {
    current = hexToOklch(base.value);
  } else if (base.kind === "tailwind") {
    // Unknown names (typos, removed shades) fall back to neutral.
    current = hexToOklch(getTailwindHex(base.color) ?? "#808080");
  } else {
    const hex = resolve(base.token);
    current = hex ? hexToOklch(hex) : { l: 0, c: 0, h: 0 };
  }
  for (const op of ops) current = applyOp(current, op, resolve);
  return current;
}

export function resolveDerivationToHex(
  base: DerivationBase,
  ops: DerivationOp[],
  resolve: ResolveRefHex
): string {
  return oklchToHex(resolveDerivation(base, ops, resolve));
}

// ============================================================================
// CSS RELATIVE-COLOR EMISSION
// ============================================================================

/**
 * Build the CSS expression that mirrors the derivation pipeline. Uses
 * `oklch(from <prev> ...)` and `color-mix(...)` so a runtime change of
 * the base CSS variable cascades through.
 *
 * `cssVarFor(ref)` returns the CSS var reference (e.g.
 * `var(--color-blue-600)`) for a token name. `tailwindCssVar(color)`
 * returns `var(--color-slate-500)` style refs.
 *
 * `autoContrast` is resolved at build time — the chosen branch is baked
 * in as a `var(--<chosen>)` reference and subsequent ops continue from
 * there. So the runtime-live ops are lighten/darken/mute/mix; the
 * autoContrast pick is fixed at build.
 */
export function emitCssRelativeColor(
  base: DerivationBase,
  ops: DerivationOp[],
  cssVarFor: (ref: TokenRef) => string | null,
  tailwindCssVar: (color: string) => string,
  resolve: ResolveRefHex
): string {
  let expr: string;
  if (base.kind === "raw") expr = base.value;
  else if (base.kind === "tailwind") expr = tailwindCssVar(base.color);
  else expr = cssVarFor(base.token) ?? "#000000";

  // Track the running OKLCH so autoContrast can decide its branch.
  let runningOklch: OklchColor;
  if (base.kind === "raw") runningOklch = hexToOklch(base.value);
  else if (base.kind === "tailwind")
    runningOklch = hexToOklch(getTailwindHex(base.color) ?? "#808080");
  else {
    const hex = resolve(base.token);
    runningOklch = hex ? hexToOklch(hex) : { l: 0, c: 0, h: 0 };
  }

  for (const op of ops) {
    if (op.op === "lighten") {
      expr = `oklch(from ${expr} calc(l + ${op.amount}) c h)`;
      runningOklch = applyOp(runningOklch, op, resolve);
    } else if (op.op === "darken") {
      expr = `oklch(from ${expr} calc(l - ${op.amount}) c h)`;
      runningOklch = applyOp(runningOklch, op, resolve);
    } else if (op.op === "mute") {
      expr = `oklch(from ${expr} l calc(c * ${1 - op.amount}) h)`;
      runningOklch = applyOp(runningOklch, op, resolve);
    } else if (op.op === "mix") {
      const otherVar = cssVarFor(op.with);
      const w = Math.round(op.weight * 100);
      const baseShare = 100 - w;
      expr = `color-mix(in oklch, ${expr} ${baseShare}%, ${otherVar ?? "#000000"} ${w}%)`;
      runningOklch = applyOp(runningOklch, op, resolve);
    } else if (op.op === "autoContrast") {
      const threshold = op.threshold ?? 0.6;
      const useDark = runningOklch.l >= threshold;
      const chosen = useDark ? op.dark : op.light;
      if (chosen) {
        expr = cssVarFor(chosen) ?? (useDark ? "#000000" : "#ffffff");
      } else {
        expr = useDark ? "#000000" : "#ffffff";
      }
      runningOklch = hexToOklch(useDark ? "#000000" : "#ffffff");
      if (chosen) {
        const hex = resolve(chosen);
        if (hex) runningOklch = hexToOklch(hex);
      }
    } else if (op.op === "shift") {
      // Precompute ΔL using the running OKLCH at build time (polarity
      // and headroom can't be expressed in pure CSS). ΔC is direct.
      // Cascade still works for downstream base changes — they shift
      // the rendered hex; only the direction/magnitude is baked.
      const surfaceIsDark = runningOklch.l < 0.6;
      const direction = surfaceIsDark ? +1 : -1;
      const movingAway = op.stepStrength >= 0;
      const headroom = movingAway
        ? surfaceIsDark
          ? 1 - runningOklch.l
          : runningOklch.l
        : surfaceIsDark
          ? runningOklch.l
          : 1 - runningOklch.l;
      const deltaL = direction * op.stepStrength * headroom * 0.6;
      const deltaC = op.chromaDelta ?? 0;
      const lExpr =
        deltaL === 0
          ? "l"
          : deltaL >= 0
            ? `calc(l + ${deltaL.toFixed(4)})`
            : `calc(l - ${(-deltaL).toFixed(4)})`;
      const cExpr =
        deltaC === 0
          ? "c"
          : deltaC >= 0
            ? `calc(c + ${deltaC.toFixed(4)})`
            : `calc(c - ${(-deltaC).toFixed(4)})`;
      expr = `oklch(from ${expr} ${lExpr} ${cExpr} h)`;
      runningOklch = applyOp(runningOklch, op, resolve);
    }
  }
  return expr;
}

// Re-export the interpolate primitive in case callers want to do their
// own OKLCH lerp later. Kept here so consumers don't need a direct
// culori dep just to mirror our space.
export { interpolate as culoriInterpolate };
