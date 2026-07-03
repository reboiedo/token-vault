/**
 * Typography Scale Utilities
 *
 * Utilities for fluid typography calculations using CSS clamp().
 * Generates typography tokens that scale between viewport sizes.
 *
 * Unlike spacing (which uses multipliers on a base), typography uses
 * direct min/max pixel values per step for more precise control.
 */

// ============================================================================
// Types
// ============================================================================

export interface ViewportConfig {
  minWidth: number;      // e.g., 360
  maxWidth: number;      // e.g., 1240
}

export interface TypeStep {
  minPx: number;         // Size at min viewport (e.g., 12)
  maxPx: number;         // Size at max viewport (e.g., 16)
}

export interface TypographyConfig {
  steps: TypeStep[];     // Each step has its own min/max
  unit: "rem" | "px";
  prefix: string;        // e.g., "type"
}

export interface GeneratedTypography {
  name: string;          // e.g., "type.12" or "type.step-1"
  value: string;         // clamp() formula or static value
  minPx: number;
  maxPx: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const defaultTypographyConfig: TypographyConfig = {
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
 * Generate a CSS clamp() formula for fluid typography
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

// ============================================================================
// Main Generation Function
// ============================================================================

/**
 * Generate typography tokens from config
 *
 * Naming convention:
 * - Static steps (min === max): "type.{value}" e.g., "type.12"
 * - Fluid steps (min !== max): "type.step-{n}" e.g., "type.step-1"
 */
export function generateTypographyScale(
  config: TypographyConfig,
  viewport: ViewportConfig
): GeneratedTypography[] {
  const { steps, unit, prefix } = config;
  const results: GeneratedTypography[] = [];

  // Sort steps by minPx for consistent ordering
  const sortedSteps = [...steps].sort((a, b) => a.minPx - b.minPx);

  // Track fluid step counter (for naming fluid steps)
  let fluidStepCounter = 1;

  for (const step of sortedSteps) {
    const { minPx, maxPx } = step;
    const isStatic = minPx === maxPx;

    // Determine name based on whether it's static or fluid
    let stepName: string;
    if (isStatic) {
      // Static: use the value as the name
      stepName = `${minPx}`;
    } else {
      // Fluid: use step-{n}
      stepName = `step-${fluidStepCounter}`;
      fluidStepCounter++;
    }

    // Generate value
    const value = calculateClamp(minPx, maxPx, viewport, unit);

    results.push({
      name: `${prefix}.${stepName}`,
      value,
      minPx,
      maxPx,
    });
  }

  return results;
}

// ============================================================================
// Validation & Helpers
// ============================================================================

/**
 * Validate and fill in defaults for TypographyConfig
 */
export function validateTypographyConfig(
  config: Partial<TypographyConfig>
): TypographyConfig {
  return {
    steps: config.steps ?? defaultTypographyConfig.steps,
    unit: config.unit ?? defaultTypographyConfig.unit,
    prefix: config.prefix ?? defaultTypographyConfig.prefix,
  };
}

/**
 * Get the next smaller type step suggestion
 */
export function getNextSmallerTypeStep(currentSmallest: TypeStep): TypeStep {
  // Suggest a smaller static step based on common typography sizes
  const smallerSizes = [10, 11, 12, 13, 14];
  const targetSize = currentSmallest.minPx - 2;
  const closestSmaller = smallerSizes.filter(s => s < currentSmallest.minPx).pop();

  const newMin = closestSmaller ?? Math.max(8, targetSize);
  return { minPx: newMin, maxPx: newMin }; // Static by default
}

/**
 * Get the next larger type step suggestion
 */
export function getNextLargerTypeStep(currentLargest: TypeStep): TypeStep {
  // For fluid steps, increase with a typical ratio (~1.25-1.5x)
  const newMin = Math.round(currentLargest.maxPx * 1.25);
  const newMax = Math.round(currentLargest.maxPx * 1.5);
  return { minPx: newMin, maxPx: newMax };
}
