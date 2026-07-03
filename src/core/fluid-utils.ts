/**
 * Fluid Scales Utilities
 *
 * Unified utilities for fluid spacing and typography calculations.
 * Generates fluid tokens that scale between viewport sizes using CSS clamp().
 */

// ============================================================================
// Types
// ============================================================================

export interface ViewportConfig {
  minWidth: number;  // e.g., 360
  maxWidth: number;  // e.g., 1240
}

// Spacing uses multipliers applied to a base size
export interface SpacingStep {
  name: string;      // e.g., "s", "m", "l"
  multiplier: number; // e.g., 1, 1.5, 2
}

export interface SpacingPair {
  from: string;      // e.g., "s"
  to: string;        // e.g., "l"
}

// A fixed (static, non-fluid) spacing value in px. Emitted as a token
// named by its value (e.g. 4 → "space.4") that does not scale with the
// viewport — mirrors typography's static steps (minPx === maxPx).
export interface FixedSpacingStep {
  value: number;     // e.g., 2, 4, 8
}

export interface SpacingScaleConfig {
  baseMin: number;   // Base size at min viewport (e.g., 18)
  baseMax: number;   // Base size at max viewport (e.g., 20)
  steps: SpacingStep[];
  fixedSteps?: FixedSpacingStep[]; // Static px values, named by value
  includePairs: boolean;
  customPairs: SpacingPair[];
  unit: "rem" | "px";
  prefix: string;    // e.g., "space"
}

// Type uses direct min/max values per step
export interface TypeStep {
  minPx: number;     // Size at min viewport (e.g., 12)
  maxPx: number;     // Size at max viewport (e.g., 16)
}

export interface TypeScaleConfig {
  steps: TypeStep[]; // Each step has its own min/max
  unit: "rem" | "px";
  prefix: string;    // e.g., "type"
  baseStepIndex?: number; // Index of the base step (step-1). Defaults to 0 if not set.
}

export interface FluidScalesConfig {
  viewport: ViewportConfig;
  breakpoints?: number[];
  spacing?: SpacingScaleConfig;
  type?: TypeScaleConfig;
}

export interface GeneratedToken {
  name: string;      // e.g., "space.s" or "type.12" or "type.step-1"
  value: string;     // clamp() formula or static value
  minPx: number;
  maxPx: number;
  isPair?: boolean;
  scaleType: "spacing" | "type";
}

// Legacy aliases for backward compat
export type ScaleStep = SpacingStep;
export type ScalePair = SpacingPair;
export type ScaleConfig = SpacingScaleConfig;

// Legacy types for migration
export interface LegacyViewportConfig {
  minWidth: number;
  maxWidth: number;
  minFontSize: number;
  maxFontSize: number;
}

export interface LegacySpacingScaleConfig {
  viewport: LegacyViewportConfig;
  steps: ScaleStep[];
  includePairs: boolean;
  customPairs: ScalePair[];
  unit: "rem" | "px";
  prefix: string;
  breakpoints?: number[];
}

// ============================================================================
// Constants
// ============================================================================

/**
 * T-shirt size naming for spacing steps.
 */
export const T_SHIRT_SIZES = {
  negative: ["5xs", "4xs", "3xs", "2xs", "xs"],
  base: "s",
  positive: ["m", "l", "xl", "2xl", "3xl", "4xl", "5xl"],
};

/**
 * Get the t-shirt size name for a given position relative to base
 */
export function getTShirtSizeName(position: number): string {
  if (position === 0) {
    return T_SHIRT_SIZES.base;
  }
  if (position < 0) {
    const absPos = Math.abs(position);
    if (absPos <= T_SHIRT_SIZES.negative.length) {
      return T_SHIRT_SIZES.negative[T_SHIRT_SIZES.negative.length - absPos];
    }
    return `${absPos}xs`;
  }
  if (position <= T_SHIRT_SIZES.positive.length) {
    return T_SHIRT_SIZES.positive[position - 1];
  }
  return `${position - 2}xl`;
}

/**
 * Rename steps based on their sorted position relative to base (multiplier = 1)
 */
export function renameStepsByPosition(steps: ScaleStep[]): ScaleStep[] {
  if (steps.length === 0) return [];

  const sorted = [...steps].sort((a, b) => a.multiplier - b.multiplier);
  let baseIndex = sorted.findIndex(s => s.multiplier === 1);

  if (baseIndex === -1) {
    let minDiff = Infinity;
    sorted.forEach((s, i) => {
      const diff = Math.abs(s.multiplier - 1);
      if (diff < minDiff) {
        minDiff = diff;
        baseIndex = i;
      }
    });
    sorted[baseIndex] = { ...sorted[baseIndex], multiplier: 1 };
  }

  return sorted.map((step, index) => ({
    ...step,
    name: getTShirtSizeName(index - baseIndex),
  }));
}

// ============================================================================
// Default Configurations
// ============================================================================

export const defaultSpacingScale: SpacingScaleConfig = {
  baseMin: 18,
  baseMax: 20,
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
};

export const defaultTypeScale: TypeScaleConfig = {
  steps: [
    { minPx: 12, maxPx: 12 },  // Static: type.12
    { minPx: 14, maxPx: 14 },  // Static: type.14
    { minPx: 16, maxPx: 18 },  // Fluid: type.step-1
    { minPx: 20, maxPx: 24 },  // Fluid: type.step-2
    { minPx: 24, maxPx: 32 },  // Fluid: type.step-3
    { minPx: 32, maxPx: 48 },  // Fluid: type.step-4
  ],
  unit: "rem",
  prefix: "type",
};

export const defaultFluidScalesConfig: FluidScalesConfig = {
  viewport: {
    minWidth: 360,
    maxWidth: 1240,
  },
  breakpoints: [],
  spacing: defaultSpacingScale,
  type: undefined, // Type scale disabled by default
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
 * Calculate the pixel value for a step
 */
export function calculateStepValue(
  multiplier: number,
  baseSize: number
): number {
  return round(multiplier * baseSize, 2);
}

/**
 * Generate a CSS clamp() formula for fluid scaling
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
    const slope = (maxPx - minPx) / (maxVwPx - minVwPx);
    const intercept = minPx - slope * minVwPx;
    const slopeVw = round(slope * 100, 4);
    const interceptPx = round(intercept, 4);

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

  if (minRem === maxRem) {
    return `${round(minRem, 4)}rem`;
  }

  const slope = (maxRem - minRem) / (maxVwRem - minVwRem);
  const intercept = minRem - slope * minVwRem;
  const slopeVw = round(slope * 100, 4);
  const interceptRem = round(intercept, 4);

  const minStr = `${round(minRem, 4)}rem`;
  const maxStr = `${round(maxRem, 4)}rem`;

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
 * Calculate the interpolated value at a specific viewport width
 */
export function calculateValueAtViewport(
  minPx: number,
  maxPx: number,
  viewport: ViewportConfig,
  targetWidth: number
): number {
  if (targetWidth <= viewport.minWidth) return minPx;
  if (targetWidth >= viewport.maxWidth) return maxPx;

  const progress = (targetWidth - viewport.minWidth) / (viewport.maxWidth - viewport.minWidth);
  return round(minPx + (maxPx - minPx) * progress, 2);
}

/**
 * Generate single-step pairs from sorted steps
 */
export function generateSingleStepPairs(steps: ScaleStep[]): ScalePair[] {
  const pairs: ScalePair[] = [];
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
export function sortStepsByMultiplier(steps: ScaleStep[]): ScaleStep[] {
  return [...steps].sort((a, b) => a.multiplier - b.multiplier);
}

// ============================================================================
// Generation Functions
// ============================================================================

/**
 * Generate tokens for spacing scale (uses multipliers)
 */
export function generateSpacingScale(
  scaleConfig: SpacingScaleConfig,
  viewport: ViewportConfig
): GeneratedToken[] {
  const { baseMin, baseMax, steps, fixedSteps = [], includePairs, customPairs, unit, prefix } = scaleConfig;
  const results: GeneratedToken[] = [];

  const sortedSteps = sortStepsByMultiplier(steps);

  // Fixed (static) values first, sorted ascending. Named by value
  // ("space.4"), deduped, and skipped if a multiplier step already
  // claims the same name. calculateClamp emits a plain static value
  // when min === max, so these never scale with the viewport.
  const stepNames = new Set(sortedSteps.map((s) => s.name));
  const fixedValues = [...new Set(fixedSteps.map((f) => f.value))]
    .filter((v) => v > 0 && !stepNames.has(String(v)))
    .sort((a, b) => a - b);
  for (const value of fixedValues) {
    results.push({
      name: prefix ? `${prefix}.${value}` : `${value}`,
      value: calculateClamp(value, value, viewport, unit),
      minPx: value,
      maxPx: value,
      isPair: false,
      scaleType: "spacing",
    });
  }

  // Generate individual step tokens
  for (const step of sortedSteps) {
    const minPx = calculateStepValue(step.multiplier, baseMin);
    const maxPx = calculateStepValue(step.multiplier, baseMax);
    const clampValue = calculateClamp(minPx, maxPx, viewport, unit);

    results.push({
      name: prefix ? `${prefix}.${step.name}` : step.name,
      value: clampValue,
      minPx,
      maxPx,
      isPair: false,
      scaleType: "spacing",
    });
  }

  // Generate pair tokens if enabled
  if (includePairs) {
    const singleStepPairs = generateSingleStepPairs(sortedSteps);

    for (const pair of singleStepPairs) {
      const fromStep = sortedSteps.find((s) => s.name === pair.from);
      const toStep = sortedSteps.find((s) => s.name === pair.to);

      if (fromStep && toStep) {
        const minPx = calculateStepValue(fromStep.multiplier, baseMin);
        const maxPx = calculateStepValue(toStep.multiplier, baseMax);
        const clampValue = calculateClamp(minPx, maxPx, viewport, unit);

        results.push({
          name: prefix ? `${prefix}.${pair.from}-${pair.to}` : `${pair.from}-${pair.to}`,
          value: clampValue,
          minPx,
          maxPx,
          isPair: true,
          scaleType: "spacing",
        });
      }
    }

    for (const pair of customPairs) {
      const fromStep = sortedSteps.find((s) => s.name === pair.from);
      const toStep = sortedSteps.find((s) => s.name === pair.to);

      if (fromStep && toStep) {
        const minPx = calculateStepValue(fromStep.multiplier, baseMin);
        const maxPx = calculateStepValue(toStep.multiplier, baseMax);
        const clampValue = calculateClamp(minPx, maxPx, viewport, unit);

        results.push({
          name: prefix ? `${prefix}.${pair.from}-${pair.to}` : `${pair.from}-${pair.to}`,
          value: clampValue,
          minPx,
          maxPx,
          isPair: true,
          scaleType: "spacing",
        });
      }
    }
  }

  return results;
}

// Keep legacy alias
export const generateScale = generateSpacingScale;

/**
 * Generate tokens for type scale (uses direct min/max values)
 * Naming:
 * - Static (min === max): "type.{value}" e.g., "type.12"
 * - Fluid (min !== max): "type.step-{n}" where n is relative to baseStepIndex
 *   - baseStepIndex step = "step-1"
 *   - Steps above base = "step-1", "step-2", ...
 *   - Steps below base = "step--1", "step--2", ...
 */
export function generateTypeScale(
  scaleConfig: TypeScaleConfig,
  viewport: ViewportConfig
): GeneratedToken[] {
  const { steps, unit, prefix, baseStepIndex = 0 } = scaleConfig;
  const results: GeneratedToken[] = [];

  // Sort steps by minPx for consistent ordering
  const sortedSteps = [...steps].sort((a, b) => a.minPx - b.minPx);

  // Build a list of fluid step indices (in sorted order)
  const fluidStepIndices: number[] = [];
  sortedSteps.forEach((step, idx) => {
    if (step.minPx !== step.maxPx) {
      fluidStepIndices.push(idx);
    }
  });

  // Find the position of baseStepIndex within fluid steps
  // baseStepIndex is the index in the sorted array (counting only fluid steps)
  const clampedBaseIndex = Math.max(0, Math.min(baseStepIndex, fluidStepIndices.length - 1));

  for (let sortedIdx = 0; sortedIdx < sortedSteps.length; sortedIdx++) {
    const step = sortedSteps[sortedIdx];
    const { minPx, maxPx } = step;
    const isStatic = minPx === maxPx;

    // Determine name based on whether it's static or fluid
    let stepName: string;
    if (isStatic) {
      // Static: use the value as the name
      stepName = `${minPx}`;
    } else {
      // Fluid: calculate step number relative to base
      const fluidPosition = fluidStepIndices.indexOf(sortedIdx);
      const relativePosition = fluidPosition - clampedBaseIndex;

      const stepNumber = relativePosition >= 0 ? relativePosition + 1 : relativePosition;
      stepName = `step-${stepNumber}`;
    }

    // Generate value
    const value = calculateClamp(minPx, maxPx, viewport, unit);

    results.push({
      name: prefix ? `${prefix}.${stepName}` : stepName,
      value,
      minPx,
      maxPx,
      isPair: false,
      scaleType: "type",
    });
  }

  return results;
}

/**
 * Generate all tokens from a FluidScalesConfig
 */
export function generateAllScales(config: FluidScalesConfig): GeneratedToken[] {
  const results: GeneratedToken[] = [];

  if (config.spacing) {
    results.push(...generateSpacingScale(config.spacing, config.viewport));
  }

  if (config.type) {
    results.push(...generateTypeScale(config.type, config.viewport));
  }

  return results;
}

// ============================================================================
// Migration
// ============================================================================

/**
 * Migrate legacy SpacingScaleConfig to new FluidScalesConfig
 */
export function migrateFromLegacy(legacy: LegacySpacingScaleConfig): FluidScalesConfig {
  return {
    viewport: {
      minWidth: legacy.viewport.minWidth,
      maxWidth: legacy.viewport.maxWidth,
    },
    breakpoints: legacy.breakpoints,
    spacing: {
      baseMin: legacy.viewport.minFontSize,
      baseMax: legacy.viewport.maxFontSize,
      steps: legacy.steps,
      includePairs: legacy.includePairs,
      customPairs: legacy.customPairs,
      unit: legacy.unit,
      prefix: legacy.prefix,
    },
    // type: undefined - user can enable later
  };
}

/**
 * Convert FluidScalesConfig back to legacy format (for backward compat in Figma plugin)
 * This creates a pseudo-viewport that combines spacing baseMin/baseMax with viewport widths
 */
export function toLegacyFormat(config: FluidScalesConfig): LegacySpacingScaleConfig | null {
  if (!config.spacing) return null;

  return {
    viewport: {
      minWidth: config.viewport.minWidth,
      maxWidth: config.viewport.maxWidth,
      minFontSize: config.spacing.baseMin,
      maxFontSize: config.spacing.baseMax,
    },
    steps: config.spacing.steps,
    includePairs: config.spacing.includePairs,
    customPairs: config.spacing.customPairs,
    unit: config.spacing.unit,
    prefix: config.spacing.prefix,
    breakpoints: config.breakpoints,
  };
}

// ============================================================================
// Validation & Helpers
// ============================================================================

/**
 * Validate and fill in defaults for a FluidScalesConfig
 */
export function validateFluidScalesConfig(
  config: Partial<FluidScalesConfig>
): FluidScalesConfig {
  return {
    viewport: config.viewport ?? defaultFluidScalesConfig.viewport,
    breakpoints: config.breakpoints ?? defaultFluidScalesConfig.breakpoints,
    spacing: config.spacing,
    type: config.type,
  };
}

/**
 * Check if a step name already exists in a scale
 */
export function stepNameExists(steps: ScaleStep[], name: string): boolean {
  return steps.some((s) => s.name === name);
}

/**
 * Get a unique step name by appending a number if needed
 */
export function getUniqueStepName(steps: ScaleStep[], baseName: string): string {
  if (!stepNameExists(steps, baseName)) {
    return baseName;
  }

  let counter = 2;
  while (stepNameExists(steps, `${baseName}${counter}`)) {
    counter++;
  }
  return `${baseName}${counter}`;
}

/**
 * Get the next smaller t-shirt size name (for spacing)
 */
export function getNextSmallerSize(currentSmallest: string): string {
  const negIndex = T_SHIRT_SIZES.negative.indexOf(currentSmallest);
  if (negIndex > 0) {
    return T_SHIRT_SIZES.negative[negIndex - 1];
  }
  if (currentSmallest === T_SHIRT_SIZES.base) {
    return T_SHIRT_SIZES.negative[T_SHIRT_SIZES.negative.length - 1];
  }
  const numMatch = currentSmallest.match(/^(\d+)xs$/);
  if (numMatch) {
    const num = parseInt(numMatch[1], 10);
    return `${num + 1}xs`;
  }
  return "6xs";
}

/**
 * Get the next larger t-shirt size name (for spacing)
 */
export function getNextLargerSize(currentLargest: string): string {
  const posIndex = T_SHIRT_SIZES.positive.indexOf(currentLargest);
  if (posIndex >= 0 && posIndex < T_SHIRT_SIZES.positive.length - 1) {
    return T_SHIRT_SIZES.positive[posIndex + 1];
  }
  if (currentLargest === T_SHIRT_SIZES.base) {
    return T_SHIRT_SIZES.positive[0];
  }
  const numMatch = currentLargest.match(/^(\d+)xl$/);
  if (numMatch) {
    const num = parseInt(numMatch[1], 10);
    return `${num + 1}xl`;
  }
  if (currentLargest === "xl") {
    return "2xl";
  }
  return "6xl";
}

/**
 * Get the next smaller type step name
 */
export function getNextSmallerTypeStep(currentSmallest: string): string {
  const match = currentSmallest.match(/^step-(-?\d+)$/);
  if (match) {
    const num = parseInt(match[1], 10);
    return `step-${num - 1}`;
  }
  return "step--1";
}

/**
 * Get the next larger type step name
 */
export function getNextLargerTypeStep(currentLargest: string): string {
  const match = currentLargest.match(/^step-(-?\d+)$/);
  if (match) {
    const num = parseInt(match[1], 10);
    return `step-${num + 1}`;
  }
  return "step-1";
}
