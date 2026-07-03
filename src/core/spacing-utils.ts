/**
 * Fluid Spacing Utilities
 *
 * Utopia-style fluid spacing calculations using CSS clamp().
 * Generates fluid spacing tokens that scale between viewport sizes.
 */

// ============================================================================
// Types
// ============================================================================

export interface ViewportConfig {
  minWidth: number;      // e.g., 360
  maxWidth: number;      // e.g., 1240
  minFontSize: number;   // e.g., 18 (base for min viewport)
  maxFontSize: number;   // e.g., 20 (base for max viewport)
}

export interface SpacingStep {
  name: string;          // e.g., "s", "m", "l", "3xs"
  multiplier: number;    // e.g., 1, 1.5, 2
}

export interface SpacingPair {
  from: string;          // e.g., "s"
  to: string;            // e.g., "l"
}

export interface SpacingScaleConfig {
  viewport: ViewportConfig;
  steps: SpacingStep[];
  includePairs: boolean;
  customPairs: SpacingPair[];
  unit: "rem" | "px";
  prefix: string;        // e.g., "space"
  breakpoints?: number[]; // Additional viewport widths for Figma export (e.g., [768, 1024])
}

export interface GeneratedSpacing {
  name: string;          // e.g., "space.s" or "space.s-m"
  value: string;         // e.g., "clamp(1.125rem, 1.0739rem + 0.2273vw, 1.25rem)"
  minPx: number;         // e.g., 18
  maxPx: number;         // e.g., 20
  isPair?: boolean;      // true for pair tokens
}

// ============================================================================
// Constants
// ============================================================================

/**
 * T-shirt size naming convention.
 * Negative sizes: 3xs, 2xs, xs
 * Base: s (multiplier = 1)
 * Positive sizes: m, l, xl, 2xl, 3xl, 4xl, 5xl, ...
 */
export const T_SHIRT_SIZES = {
  negative: ["5xs", "4xs", "3xs", "2xs", "xs"],
  base: "s",
  positive: ["m", "l", "xl", "2xl", "3xl", "4xl", "5xl"],
};

/**
 * Get the t-shirt size name for a given position relative to base
 * @param position - negative for sizes smaller than base, 0 for base, positive for larger
 */
export function getTShirtSizeName(position: number): string {
  if (position === 0) {
    return T_SHIRT_SIZES.base;
  }
  if (position < 0) {
    // Negative positions: -1 = xs, -2 = 2xs, -3 = 3xs, etc.
    const absPos = Math.abs(position);
    if (absPos <= T_SHIRT_SIZES.negative.length) {
      return T_SHIRT_SIZES.negative[T_SHIRT_SIZES.negative.length - absPos];
    }
    // Beyond predefined, generate name
    return `${absPos}xs`;
  }
  // Positive positions: 1 = m, 2 = l, 3 = xl, 4 = 2xl, etc.
  if (position <= T_SHIRT_SIZES.positive.length) {
    return T_SHIRT_SIZES.positive[position - 1];
  }
  // Beyond predefined, generate name
  return `${position - 2}xl`;
}

/**
 * Rename steps based on their sorted position relative to base (multiplier = 1)
 * Steps are sorted by multiplier, then named according to t-shirt convention.
 * Ensures there's always a step with multiplier exactly 1 (the base).
 */
export function renameStepsByPosition(steps: SpacingStep[]): SpacingStep[] {
  if (steps.length === 0) return [];

  // Sort by multiplier
  const sorted = [...steps].sort((a, b) => a.multiplier - b.multiplier);

  // Find the base step (multiplier = 1)
  let baseIndex = sorted.findIndex(s => s.multiplier === 1);

  // If no step has exactly multiplier 1, find closest and set it to 1
  if (baseIndex === -1) {
    let minDiff = Infinity;
    sorted.forEach((s, i) => {
      const diff = Math.abs(s.multiplier - 1);
      if (diff < minDiff) {
        minDiff = diff;
        baseIndex = i;
      }
    });
    // Force the base step to have multiplier 1
    sorted[baseIndex] = { ...sorted[baseIndex], multiplier: 1 };
  }

  // Rename each step based on position relative to base
  return sorted.map((step, index) => ({
    ...step,
    name: getTShirtSizeName(index - baseIndex),
  }));
}

/**
 * Get the next smaller t-shirt size name
 */
export function getNextSmallerSize(currentSmallest: string): string {
  const negIndex = T_SHIRT_SIZES.negative.indexOf(currentSmallest);
  if (negIndex > 0) {
    return T_SHIRT_SIZES.negative[negIndex - 1];
  }
  if (currentSmallest === T_SHIRT_SIZES.base) {
    return T_SHIRT_SIZES.negative[T_SHIRT_SIZES.negative.length - 1];
  }
  // Already at smallest possible
  const numMatch = currentSmallest.match(/^(\d+)xs$/);
  if (numMatch) {
    const num = parseInt(numMatch[1], 10);
    return `${num + 1}xs`;
  }
  return "6xs"; // Fallback
}

/**
 * Get the next larger t-shirt size name
 */
export function getNextLargerSize(currentLargest: string): string {
  const posIndex = T_SHIRT_SIZES.positive.indexOf(currentLargest);
  if (posIndex >= 0 && posIndex < T_SHIRT_SIZES.positive.length - 1) {
    return T_SHIRT_SIZES.positive[posIndex + 1];
  }
  if (currentLargest === T_SHIRT_SIZES.base) {
    return T_SHIRT_SIZES.positive[0];
  }
  // Already at largest in predefined list
  const numMatch = currentLargest.match(/^(\d+)xl$/);
  if (numMatch) {
    const num = parseInt(numMatch[1], 10);
    return `${num + 1}xl`;
  }
  if (currentLargest === "xl") {
    return "2xl";
  }
  return "6xl"; // Fallback
}

// ============================================================================
// Default Configuration
// ============================================================================

export const defaultSpacingScaleConfig: SpacingScaleConfig = {
  viewport: {
    minWidth: 360,
    maxWidth: 1240,
    minFontSize: 18,
    maxFontSize: 20,
  },
  steps: [
    { name: "3xs", multiplier: 0.25 },
    { name: "2xs", multiplier: 0.5 },
    { name: "xs", multiplier: 0.75 },
    { name: "s", multiplier: 1 },      // Base
    { name: "m", multiplier: 1.5 },
    { name: "l", multiplier: 2 },
    { name: "xl", multiplier: 3 },
    { name: "2xl", multiplier: 4 },
    { name: "3xl", multiplier: 6 },
  ],
  includePairs: true,
  customPairs: [],
  unit: "rem",
  prefix: "space",
  breakpoints: [], // Additional viewport widths for Figma export
};

// ============================================================================
// Calculation Functions
// ============================================================================

/**
 * Convert pixels to rem (assuming 16px base)
 */
export function pxToRem(px: number): number {
  return px / 16;
}

/**
 * Round a number to a specified number of decimal places
 */
export function round(value: number, decimals: number = 4): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Calculate the pixel value for a step at a given viewport
 */
export function calculateStepValue(
  multiplier: number,
  baseFontSize: number
): number {
  return round(multiplier * baseFontSize, 2);
}

/**
 * Generate a CSS clamp() formula for fluid spacing
 *
 * Formula:
 * clamp(minValue, minValue + (maxValue - minValue) * ((100vw - minVw) / (maxVw - minVw)), maxValue)
 *
 * Simplified form used by Utopia:
 * clamp(minRem, calcValue, maxRem)
 * where calcValue = minRem + (maxRem - minRem) * ((100vw - minVwRem) / (maxVwRem - minVwRem))
 *
 * Further simplified:
 * clamp(minRem, minRem + slope * (100vw - minVwRem), maxRem)
 * = clamp(minRem, (minRem - slope * minVwRem) + slope * 100vw, maxRem)
 * = clamp(minRem, intercept + slope * 100vw, maxRem)
 */
export function calculateClamp(
  minPx: number,
  maxPx: number,
  viewport: ViewportConfig,
  unit: "rem" | "px" = "rem"
): string {
  const minVwPx = viewport.minWidth;
  const maxVwPx = viewport.maxWidth;

  if (unit === "px") {
    // Pixel-based clamp
    const slope = (maxPx - minPx) / (maxVwPx - minVwPx);
    const intercept = minPx - slope * minVwPx;

    const slopeVw = round(slope * 100, 4);
    const interceptPx = round(intercept, 4);

    // If min and max are the same, no fluid needed
    if (minPx === maxPx) {
      return `${minPx}px`;
    }

    return `clamp(${minPx}px, ${interceptPx}px + ${slopeVw}vw, ${maxPx}px)`;
  }

  // REM-based clamp (default)
  const minRem = pxToRem(minPx);
  const maxRem = pxToRem(maxPx);
  const minVwRem = pxToRem(minVwPx);
  const maxVwRem = pxToRem(maxVwPx);

  // If min and max are the same, no fluid needed
  if (minRem === maxRem) {
    return `${round(minRem, 4)}rem`;
  }

  // Calculate slope: how much the value changes per viewport unit
  const slope = (maxRem - minRem) / (maxVwRem - minVwRem);

  // Calculate intercept: the base value when vw = 0
  const intercept = minRem - slope * minVwRem;

  // Convert slope to vw units (slope * 100vw)
  const slopeVw = round(slope * 100, 4);
  const interceptRem = round(intercept, 4);

  // Format the clamp
  const minStr = `${round(minRem, 4)}rem`;
  const maxStr = `${round(maxRem, 4)}rem`;

  // Build the middle value: intercept + slope * vw
  let middleStr: string;
  if (interceptRem === 0) {
    middleStr = `${slopeVw}vw`;
  } else if (slopeVw === 0) {
    middleStr = `${interceptRem}rem`;
  } else {
    const sign = slopeVw >= 0 ? "+" : "-";
    middleStr = `${interceptRem}rem ${sign} ${Math.abs(slopeVw)}vw`;
  }

  return `clamp(${minStr}, ${middleStr}, ${maxStr})`;
}

/**
 * Calculate the interpolated spacing value at a specific viewport width
 * Uses linear interpolation between min and max values
 */
export function calculateValueAtViewport(
  minPx: number,
  maxPx: number,
  viewport: ViewportConfig,
  targetWidth: number
): number {
  // Clamp the target width to viewport bounds
  if (targetWidth <= viewport.minWidth) return minPx;
  if (targetWidth >= viewport.maxWidth) return maxPx;

  // Linear interpolation
  const progress = (targetWidth - viewport.minWidth) / (viewport.maxWidth - viewport.minWidth);
  return round(minPx + (maxPx - minPx) * progress, 2);
}

/**
 * Generate single-step pairs from sorted steps
 * e.g., [s, m, l] -> [{from: "s", to: "m"}, {from: "m", to: "l"}]
 */
export function generateSingleStepPairs(steps: SpacingStep[]): SpacingPair[] {
  const pairs: SpacingPair[] = [];
  const sorted = [...steps].sort((a, b) => a.multiplier - b.multiplier);

  for (let i = 0; i < sorted.length - 1; i++) {
    pairs.push({
      from: sorted[i].name,
      to: sorted[i + 1].name,
    });
  }

  return pairs;
}

/**
 * Sort steps by multiplier value
 */
export function sortStepsByMultiplier(steps: SpacingStep[]): SpacingStep[] {
  return [...steps].sort((a, b) => a.multiplier - b.multiplier);
}

// ============================================================================
// Main Generation Function
// ============================================================================

/**
 * Generate all spacing tokens from a config
 * Returns individual steps and optionally pairs
 */
export function generateSpacingScale(
  config: SpacingScaleConfig
): GeneratedSpacing[] {
  const { viewport, steps, includePairs, customPairs, unit, prefix } = config;
  const results: GeneratedSpacing[] = [];

  // Sort steps by multiplier
  const sortedSteps = sortStepsByMultiplier(steps);

  // Generate individual step tokens
  for (const step of sortedSteps) {
    const minPx = calculateStepValue(step.multiplier, viewport.minFontSize);
    const maxPx = calculateStepValue(step.multiplier, viewport.maxFontSize);
    const clampValue = calculateClamp(minPx, maxPx, viewport, unit);

    results.push({
      name: prefix ? `${prefix}.${step.name}` : step.name,
      value: clampValue,
      minPx,
      maxPx,
      isPair: false,
    });
  }

  // Generate pair tokens if enabled
  if (includePairs) {
    // Single-step pairs (auto-generated from adjacent steps)
    const singleStepPairs = generateSingleStepPairs(sortedSteps);

    for (const pair of singleStepPairs) {
      const fromStep = sortedSteps.find((s) => s.name === pair.from);
      const toStep = sortedSteps.find((s) => s.name === pair.to);

      if (fromStep && toStep) {
        const minPx = calculateStepValue(fromStep.multiplier, viewport.minFontSize);
        const maxPx = calculateStepValue(toStep.multiplier, viewport.maxFontSize);
        const clampValue = calculateClamp(minPx, maxPx, viewport, unit);

        results.push({
          name: prefix ? `${prefix}.${pair.from}-${pair.to}` : `${pair.from}-${pair.to}`,
          value: clampValue,
          minPx,
          maxPx,
          isPair: true,
        });
      }
    }

    // Custom pairs
    for (const pair of customPairs) {
      const fromStep = sortedSteps.find((s) => s.name === pair.from);
      const toStep = sortedSteps.find((s) => s.name === pair.to);

      if (fromStep && toStep) {
        const minPx = calculateStepValue(fromStep.multiplier, viewport.minFontSize);
        const maxPx = calculateStepValue(toStep.multiplier, viewport.maxFontSize);
        const clampValue = calculateClamp(minPx, maxPx, viewport, unit);

        results.push({
          name: prefix ? `${prefix}.${pair.from}-${pair.to}` : `${pair.from}-${pair.to}`,
          value: clampValue,
          minPx,
          maxPx,
          isPair: true,
        });
      }
    }
  }

  return results;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a spacing scale config and fill in defaults
 */
export function validateSpacingScaleConfig(
  config: Partial<SpacingScaleConfig>
): SpacingScaleConfig {
  return {
    viewport: config.viewport ?? defaultSpacingScaleConfig.viewport,
    steps: config.steps ?? defaultSpacingScaleConfig.steps,
    includePairs: config.includePairs ?? defaultSpacingScaleConfig.includePairs,
    customPairs: config.customPairs ?? defaultSpacingScaleConfig.customPairs,
    unit: config.unit ?? defaultSpacingScaleConfig.unit,
    prefix: config.prefix ?? defaultSpacingScaleConfig.prefix,
    breakpoints: config.breakpoints ?? defaultSpacingScaleConfig.breakpoints,
  };
}

/**
 * Check if a step name already exists in the config
 */
export function stepNameExists(steps: SpacingStep[], name: string): boolean {
  return steps.some((s) => s.name === name);
}

/**
 * Get a unique step name by appending a number if needed
 */
export function getUniqueStepName(steps: SpacingStep[], baseName: string): string {
  if (!stepNameExists(steps, baseName)) {
    return baseName;
  }

  let counter = 2;
  while (stepNameExists(steps, `${baseName}${counter}`)) {
    counter++;
  }
  return `${baseName}${counter}`;
}
