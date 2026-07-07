/**
 * Modifier-aware fine stepping for numeric / range inputs.
 *
 * Arrow keys nudge by `step` (the normal jump); holding Shift nudges by a
 * finer amount (`fineStep`, default `step / 10`) for edge-case tuning —
 * e.g. OKLCH lightness/chroma where the default 0.01 jump is too coarse.
 * Callers keep their own `<input>`; typing arbitrary precision still works
 * because we only intercept the arrow keys.
 */

import type { KeyboardEvent } from "react";

/** Decimal places in a step (0.01 → 2, 0.001 → 3) so we can kill FP drift. */
function decimalsOf(step: number): number {
  const s = String(step);
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

export function fineStepKeyDown(
  e: KeyboardEvent<HTMLElement>,
  opts: {
    value: number;
    step: number;
    /** Shift-nudge increment; defaults to `step / 10`. */
    fineStep?: number;
    min?: number;
    max?: number;
    onChange: (next: number) => void;
  }
): void {
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
  e.preventDefault();
  e.stopPropagation();
  const fine = opts.fineStep ?? opts.step / 10;
  const inc = (e.shiftKey ? fine : opts.step) * (e.key === "ArrowUp" ? 1 : -1);
  let next = opts.value + inc;
  if (opts.min !== undefined) next = Math.max(opts.min, next);
  if (opts.max !== undefined) next = Math.min(opts.max, next);
  next = Number(next.toFixed(Math.max(decimalsOf(opts.step), decimalsOf(fine))));
  if (next !== opts.value) opts.onChange(next);
}
