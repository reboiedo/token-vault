/**
 * APCA (Accessible Perceptual Contrast Algorithm) — SAPC-8 / W3 0.1.9.
 *
 * Inlined per Andrew Somers' reference (MIT). We use APCA for surfaces
 * helper level contrast targets because the result is perceptually
 * uniform across hue and surface lightness — a `Lc 60` level reads the
 * same against a deep blue surface and a pale neutral one.
 *
 * Output range: roughly ±108. Positive Lc = text darker than bg (BoW),
 * negative = text lighter than bg (WoB). Authors usually want |Lc|.
 */

import { hexToOklch, oklchToHex } from "./color-utils";

// SAPC constants — APCA-W3 0.1.9.
const MAIN_TRC = 2.4;
const R_CO = 0.2126729;
const G_CO = 0.7151522;
const B_CO = 0.0721750;

const NORM_BG = 0.56;
const NORM_TXT = 0.57;
const REV_TXT = 0.62;
const REV_BG = 0.65;

const BLK_THRS = 0.022;
const BLK_CLMP = 1.414;
const SCALE_BOW = 1.14;
const SCALE_WOB = 1.14;
const LO_BOW_OFFSET = 0.027;
const LO_WOB_OFFSET = 0.027;
const DELTA_Y_MIN = 0.0005;
const LO_CLIP = 0.1;

function parseHex(hex: string): [number, number, number] | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return [r, g, b];
}

function sRGBtoY(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb;
  return (
    Math.pow(r / 255, MAIN_TRC) * R_CO +
    Math.pow(g / 255, MAIN_TRC) * G_CO +
    Math.pow(b / 255, MAIN_TRC) * B_CO
  );
}

function softClampBlack(y: number): number {
  return y < BLK_THRS ? y + Math.pow(BLK_THRS - y, BLK_CLMP) : y;
}

/**
 * Signed APCA Lc. Positive when `textHex` is darker than `bgHex`.
 * Range roughly ±108. Returns 0 for low-Y-delta pairs (per the spec).
 */
export function apcaContrast(textHex: string, bgHex: string): number {
  const yTxt = softClampBlack(sRGBtoY(textHex));
  const yBg = softClampBlack(sRGBtoY(bgHex));

  if (Math.abs(yBg - yTxt) < DELTA_Y_MIN) return 0;

  let sapc: number;
  let outputContrast: number;

  if (yBg > yTxt) {
    // BoW — text darker than bg.
    sapc = (Math.pow(yBg, NORM_BG) - Math.pow(yTxt, NORM_TXT)) * SCALE_BOW;
    outputContrast = sapc < LO_CLIP ? 0 : sapc - LO_BOW_OFFSET;
  } else {
    // WoB — text lighter than bg.
    sapc = (Math.pow(yBg, REV_BG) - Math.pow(yTxt, REV_TXT)) * SCALE_WOB;
    outputContrast = sapc > -LO_CLIP ? 0 : sapc + LO_WOB_OFFSET;
  }

  return outputContrast * 100;
}

/** Absolute APCA Lc. What authors usually want when picking a target. */
export function apcaLc(textHex: string, bgHex: string): number {
  return Math.abs(apcaContrast(textHex, bgHex));
}

// ============================================================================
// SOLVER — find the point along surface→anchor (in OKLCH) that hits a
// target APCA Lc against the surface. Bisection: APCA |Lc| is monotone
// in the lerp parameter t for any (surface, anchor) pair we care about.
// ============================================================================

interface Oklch {
  l: number;
  c: number;
  h: number;
}

function oklchLerpShortestArc(a: Oklch, b: Oklch, t: number): Oklch {
  const tt = Math.max(0, Math.min(1, t));
  const aAchromatic = a.c < 0.005;
  const bAchromatic = b.c < 0.005;

  let h: number;
  if (aAchromatic && bAchromatic) h = 0;
  else if (aAchromatic) h = b.h;
  else if (bAchromatic) h = a.h;
  else {
    const diff = ((b.h - a.h + 540) % 360) - 180;
    h = (a.h + diff * tt + 360) % 360;
  }
  return {
    l: a.l * (1 - tt) + b.l * tt,
    c: a.c * (1 - tt) + b.c * tt,
    h,
  };
}

/**
 * Walk t ∈ [0, 1] along surface→anchor in OKLCH and return the hex
 * whose absolute APCA Lc hits `targetLc` — measured against
 * `measureAgainstHex` (defaults to the surface itself).
 *
 * Measuring against a *different* backdrop lets a fg level guarantee
 * legibility on the worst-case surface it actually sits on (e.g. a
 * raised `surface` level that's lighter than `bg`): the solver then
 * pushes the fg further so it clears the target on that lighter
 * backdrop.
 *
 * APCA |Lc| is monotone in t for a contrast-extreme anchor (the `auto`
 * case), so we bisect; for an interior alias anchor it can be
 * non-monotone, so we fall back to a local refine around the closest
 * coarse sample. If the target is unreachable we clamp to the closest
 * achievable point — never fail to materialize.
 */
export function solveForApcaLc(opts: {
  surfaceHex: string;
  anchorHex: string;
  targetLc: number;
  measureAgainstHex?: string;
}): string {
  const { surfaceHex, anchorHex, targetLc } = opts;
  const measureHex = opts.measureAgainstHex ?? surfaceHex;
  const surfaceOklch = hexToOklch(surfaceHex);
  const anchorOklch = hexToOklch(anchorHex);

  const evaluate = (t: number) => {
    const m = oklchLerpShortestArc(surfaceOklch, anchorOklch, t);
    return oklchToHex(m.l, m.c, m.h);
  };
  const lcAt = (t: number) => apcaLc(evaluate(t), measureHex);

  const target = Math.max(0, targetLc);

  // Coarse scan: detect monotonicity, find the achievable ceiling and
  // the closest sample to the target.
  const N = 24;
  let monotone = true;
  let prevLc = -1;
  let bestT = 1;
  let bestErr = Infinity;
  let maxLc = 0;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const lc = lcAt(t);
    if (lc + 1e-6 < prevLc) monotone = false;
    prevLc = lc;
    if (lc > maxLc) maxLc = lc;
    const err = Math.abs(lc - target);
    if (err < bestErr) {
      bestErr = err;
      bestT = t;
    }
  }

  // Resolve the unclamped solution t, then clamp to [minMix, maxMix].
  let solvedT: number;
  if (monotone) {
    if (target >= lcAt(1)) {
      solvedT = 1; // target unreachable — clamp to the achievable ceiling
    } else {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (lcAt(mid) < target) lo = mid;
        else hi = mid;
      }
      solvedT = (lo + hi) / 2;
    }
  } else if (target >= maxLc) {
    // Non-monotone, target above the achievable max → closest sample.
    solvedT = bestT;
  } else {
    // Non-monotone — refine around the closest coarse sample.
    const lo = Math.max(0, bestT - 1 / N);
    const hi = Math.min(1, bestT + 1 / N);
    let refinedT = bestT;
    let refinedErr = bestErr;
    const STEPS = 16;
    for (let i = 0; i <= STEPS; i++) {
      const t = lo + ((hi - lo) * i) / STEPS;
      const err = Math.abs(lcAt(t) - target);
      if (err < refinedErr) {
        refinedErr = err;
        refinedT = t;
      }
    }
    solvedT = refinedT;
  }

  return evaluate(solvedT);
}
