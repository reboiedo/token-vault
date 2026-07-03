import { oklch, formatHex, parse, inGamut, displayable } from "culori";
import BezierEasing from "bezier-easing";

// Easing function type
export type EasingFunction = (t: number) => number;

// Extended curve types matching colorcolor.in presets
export type CurveType =
  | "linear"
  | "custom" // Custom bezier curve
  // Legacy types (for backwards compatibility)
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  // Sine
  | "sine-in"
  | "sine-out"
  | "sine-in-out"
  // Quadratic
  | "quad-in"
  | "quad-out"
  | "quad-in-out"
  // Cubic
  | "cubic-in"
  | "cubic-out"
  | "cubic-in-out"
  // Quartic
  | "quartic-in"
  | "quartic-out"
  | "quartic-in-out"
  // Quintic
  | "quintic-in"
  | "quintic-out"
  | "quintic-in-out"
  // Exponential
  | "expo-in"
  | "expo-out"
  | "expo-in-out"
  // Circular
  | "circ-in"
  | "circ-out"
  | "circ-in-out";

// Default custom bezier (ease-out style)
export const DEFAULT_CUSTOM_BEZIER: [number, number, number, number] = [0.25, 0.75, 0.5, 1];

// Bezier control points for each easing type [x1, y1, x2, y2]
// Values from colorcolor.in and Primer Prism
// Note: "linear" and "custom" are handled specially in getEasingFunction
export const EASING_BEZIERS: Record<CurveType, [number, number, number, number]> = {
  linear: [0, 0, 1, 1], // Not used - linear returns t directly
  custom: DEFAULT_CUSTOM_BEZIER, // Default for custom - actual values come from channel config
  // Legacy types (mapped to quadratic for backwards compatibility)
  "ease-in": [0.11, 0, 0.5, 0],
  "ease-out": [0.5, 1, 0.89, 1],
  "ease-in-out": [0.45, 0, 0.55, 1],
  // Sine
  "sine-in": [0.12, 0, 0.39, 0],
  "sine-out": [0.61, 1, 0.88, 1],
  "sine-in-out": [0.37, 0, 0.63, 1],
  // Quadratic
  "quad-in": [0.11, 0, 0.5, 0],
  "quad-out": [0.5, 1, 0.89, 1],
  "quad-in-out": [0.45, 0, 0.55, 1],
  // Cubic
  "cubic-in": [0.32, 0, 0.67, 0],
  "cubic-out": [0.33, 1, 0.68, 1],
  "cubic-in-out": [0.65, 0, 0.35, 1],
  // Quartic
  "quartic-in": [0.5, 0, 0.75, 0],
  "quartic-out": [0.25, 1, 0.5, 1],
  "quartic-in-out": [0.76, 0, 0.24, 1],
  // Quintic
  "quintic-in": [0.64, 0, 0.78, 0],
  "quintic-out": [0.22, 1, 0.36, 1],
  "quintic-in-out": [0.83, 0, 0.17, 1],
  // Exponential
  "expo-in": [0.7, 0, 0.84, 0],
  "expo-out": [0.16, 1, 0.3, 1],
  "expo-in-out": [0.87, 0, 0.13, 1],
  // Circular
  "circ-in": [0.55, 0, 1, 0.45],
  "circ-out": [0, 0.55, 0.45, 1],
  "circ-in-out": [0.85, 0, 0.15, 1],
};

// Create easing function from curve type
export function getEasingFunction(curve: CurveType): EasingFunction {
  // Linear is just identity function - no bezier needed
  if (curve === "linear") {
    return (t: number) => t;
  }
  const bezier = EASING_BEZIERS[curve];
  return BezierEasing(bezier[0], bezier[1], bezier[2], bezier[3]);
}

// Get all available curve types grouped by family
export const CURVE_FAMILIES = {
  basic: ["linear", "custom"] as CurveType[],
  sine: ["sine-in", "sine-out", "sine-in-out"] as CurveType[],
  quadratic: ["quad-in", "quad-out", "quad-in-out"] as CurveType[],
  cubic: ["cubic-in", "cubic-out", "cubic-in-out"] as CurveType[],
  quartic: ["quartic-in", "quartic-out", "quartic-in-out"] as CurveType[],
  quintic: ["quintic-in", "quintic-out", "quintic-in-out"] as CurveType[],
  exponential: ["expo-in", "expo-out", "expo-in-out"] as CurveType[],
  circular: ["circ-in", "circ-out", "circ-in-out"] as CurveType[],
};

// Flat list of all curve types
export const ALL_CURVE_TYPES: CurveType[] = Object.values(CURVE_FAMILIES).flat();

// Spline handle for tangent control
export interface SplineHandle {
  x: number; // Normalized x offset (0-1 range, relative to step spacing)
  y: number; // Y offset in channel units
}

// Spline override point with optional bezier handles
export interface SplineOverride {
  value: number;
  handleIn?: SplineHandle;  // Controls curve coming into this point
  handleOut?: SplineHandle; // Controls curve leaving this point
}

// Override can be legacy (just number) or new spline format
export type OverrideValue = number | SplineOverride;

// Helper to normalize override to SplineOverride format
export function normalizeOverride(override: OverrideValue): SplineOverride {
  if (typeof override === "number") {
    return { value: override };
  }
  return override;
}

// Helper to get just the value from an override
export function getOverrideValue(override: OverrideValue): number {
  if (typeof override === "number") {
    return override;
  }
  return override.value;
}

// ===== MONOTONIC CUBIC SPLINE (PCHIP) =====
// Based on Fritsch-Carlson algorithm for monotonic interpolation
// This ensures the curve passes through all anchor points with no overshoot

export interface SplineAnchor {
  x: number;  // Position (0-1 normalized)
  y: number;  // Value at this position
}

/**
 * Calculate gradients for monotonic cubic spline using Fritsch-Carlson method
 * This produces smooth curves that pass through all points without overshoot
 */
function calculateMonotonicGradients(anchors: SplineAnchor[]): number[] {
  const n = anchors.length;
  if (n < 2) return [0];
  if (n === 2) {
    // For 2 points, use the slope between them
    const slope = (anchors[1].y - anchors[0].y) / (anchors[1].x - anchors[0].x);
    return [slope, slope];
  }

  // Calculate slopes between consecutive points
  const deltas: number[] = [];
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    deltas.push(anchors[i + 1].x - anchors[i].x);
    slopes.push((anchors[i + 1].y - anchors[i].y) / deltas[i]);
  }

  // Initialize gradients using weighted average of adjacent slopes
  const gradients: number[] = new Array(n);

  // First point: use first slope
  gradients[0] = slopes[0];

  // Interior points: weighted harmonic mean
  for (let i = 1; i < n - 1; i++) {
    const s0 = slopes[i - 1];
    const s1 = slopes[i];

    // If slopes have different signs or either is zero, gradient is zero (local extremum)
    if (s0 * s1 <= 0) {
      gradients[i] = 0;
    } else {
      // Weighted average based on segment lengths
      const w0 = deltas[i - 1];
      const w1 = deltas[i];
      gradients[i] = (w0 + w1) / (w0 / s0 + w1 / s1);
    }
  }

  // Last point: use last slope
  gradients[n - 1] = slopes[n - 2];

  // Apply monotonicity constraints (Fritsch-Carlson)
  // Limit gradients to prevent overshoot
  for (let i = 0; i < n - 1; i++) {
    const slope = slopes[i];

    if (Math.abs(slope) < 1e-10) {
      // Flat segment: both endpoints should have zero gradient
      gradients[i] = 0;
      gradients[i + 1] = 0;
    } else {
      // Limit gradient magnitude to 3x the slope (prevents overshoot)
      const alpha = gradients[i] / slope;
      const beta = gradients[i + 1] / slope;

      // Check if we're in the monotonic region
      // The constraint is: alpha^2 + beta^2 <= 9
      const mag = alpha * alpha + beta * beta;
      if (mag > 9) {
        const tau = 3 / Math.sqrt(mag);
        gradients[i] = tau * alpha * slope;
        gradients[i + 1] = tau * beta * slope;
      }
    }
  }

  return gradients;
}

/**
 * Evaluate cubic Hermite spline at a point
 * Given two points (x0, y0) and (x1, y1) with gradients m0 and m1,
 * evaluate the spline at position x
 */
function evaluateHermite(
  x: number,
  x0: number, y0: number, m0: number,
  x1: number, y1: number, m1: number
): number {
  const h = x1 - x0;
  const t = (x - x0) / h;
  const t2 = t * t;
  const t3 = t2 * t;

  // Hermite basis functions
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  return h00 * y0 + h10 * h * m0 + h01 * y1 + h11 * h * m1;
}

/**
 * Evaluate monotonic cubic spline at position x
 * Anchors must be sorted by x position
 */
export function evaluateMonotonicSpline(anchors: SplineAnchor[], x: number): number {
  const n = anchors.length;
  if (n === 0) return 0;
  if (n === 1) return anchors[0].y;

  // Clamp x to anchor range
  if (x <= anchors[0].x) return anchors[0].y;
  if (x >= anchors[n - 1].x) return anchors[n - 1].y;

  // Find the segment containing x
  let i = 0;
  while (i < n - 1 && anchors[i + 1].x < x) {
    i++;
  }

  // Calculate gradients for all anchors
  const gradients = calculateMonotonicGradients(anchors);

  // Evaluate Hermite spline in this segment
  return evaluateHermite(
    x,
    anchors[i].x, anchors[i].y, gradients[i],
    anchors[i + 1].x, anchors[i + 1].y, gradients[i + 1]
  );
}

/**
 * Generate a smooth path through anchors using monotonic cubic spline
 * Returns array of {x, y} points for rendering
 */
export function generateMonotonicSplinePath(
  anchors: SplineAnchor[],
  numPoints: number = 100
): Array<{ x: number; y: number }> {
  if (anchors.length === 0) return [];
  if (anchors.length === 1) {
    return [{ x: anchors[0].x, y: anchors[0].y }];
  }

  const points: Array<{ x: number; y: number }> = [];
  const xMin = anchors[0].x;
  const xMax = anchors[anchors.length - 1].x;
  const step = (xMax - xMin) / (numPoints - 1);

  for (let i = 0; i < numPoints; i++) {
    const x = xMin + i * step;
    const y = evaluateMonotonicSpline(anchors, x);
    points.push({ x, y });
  }

  return points;
}

/**
 * Build anchors for a channel from its config
 * Active anchors = start point + any overrides + end point
 */
export function buildChannelAnchors(
  channel: ChannelConfig,
  steps: string[]
): SplineAnchor[] {
  const n = steps.length;
  if (n === 0) return [];
  if (n === 1) return [{ x: 0, y: channel.start }];

  const anchors: SplineAnchor[] = [];

  // Start anchor is always active
  anchors.push({ x: 0, y: channel.start });

  // Add any override points as active anchors
  if (channel.overrides) {
    for (const [step, override] of Object.entries(channel.overrides)) {
      const index = steps.indexOf(step);
      if (index > 0 && index < n - 1) {
        // Only middle points (not first/last)
        const x = index / (n - 1);
        const y = getOverrideValue(override);
        anchors.push({ x, y });
      }
    }
  }

  // End anchor is always active
  anchors.push({ x: 1, y: channel.end });

  // Sort by x position
  anchors.sort((a, b) => a.x - b.x);

  return anchors;
}

/**
 * Get channel value at a specific step using monotonic spline interpolation
 * This replaces the bezier-based interpolation for smoother, more intuitive curves
 */
export function getChannelValueSpline(
  channel: ChannelConfig,
  step: string,
  stepIndex: number,
  totalSteps: number,
  isHue: boolean = false
): number {
  // Check for direct override first
  if (channel.overrides && step in channel.overrides) {
    return getOverrideValue(channel.overrides[step]);
  }

  if (totalSteps <= 1) return channel.start;

  // Build anchors from channel config
  const anchors = buildChannelAnchors(channel,
    Array.from({ length: totalSteps }, (_, i) => i.toString())
  );

  // Rebuild with actual step names for correct override detection
  const steps = Array.from({ length: totalSteps }, (_, i) => i.toString());
  steps[stepIndex] = step; // This is a hack, we should pass actual steps

  // Evaluate spline at this position
  const x = stepIndex / (totalSteps - 1);
  let value = evaluateMonotonicSpline(anchors, x);

  // For hue, handle wrapping
  if (isHue) {
    value = ((value % 360) + 360) % 360;
  }

  return value;
}

// ===== LEGACY SPLINE FUNCTIONS (kept for backwards compatibility) =====

/**
 * Calculate auto-smooth handles for a point using Catmull-Rom style tangents
 * This creates smooth curves that pass through the control points
 * @param prevX Previous point X (normalized 0-1)
 * @param prevY Previous point Y (value)
 * @param currX Current point X (normalized 0-1)
 * @param currY Current point Y (value)
 * @param nextX Next point X (normalized 0-1)
 * @param nextY Next point Y (value)
 * @param tension Tension factor (0 = sharp, 1 = very smooth, default 0.4)
 */
export function calculateAutoSmoothHandles(
  prevX: number,
  prevY: number,
  currX: number,
  currY: number,
  nextX: number,
  nextY: number,
  tension: number = 0.4
): { handleIn: SplineHandle; handleOut: SplineHandle } {
  // Calculate tangent direction from prev to next
  const dx = nextX - prevX;
  const dy = nextY - prevY;

  // Scale by tension and distance to neighbors
  const distToPrev = currX - prevX;
  const distToNext = nextX - currX;

  return {
    handleIn: {
      x: -distToPrev * tension,
      y: -dy * tension * (distToPrev / dx),
    },
    handleOut: {
      x: distToNext * tension,
      y: dy * tension * (distToNext / dx),
    },
  };
}

/**
 * Calculate handles for an endpoint (first or last point)
 * Uses the direction to the next/prev point
 */
export function calculateEndpointHandles(
  currX: number,
  currY: number,
  neighborX: number,
  neighborY: number,
  isStart: boolean,
  tension: number = 0.4
): SplineHandle {
  const dx = neighborX - currX;
  const dy = neighborY - currY;
  const dist = Math.abs(dx);

  if (isStart) {
    return {
      x: dist * tension,
      y: dy * tension,
    };
  } else {
    return {
      x: -dist * tension,
      y: -dy * tension,
    };
  }
}

/**
 * Evaluate a cubic bezier curve at parameter t
 * P0 = start point, P1 = start handle (absolute), P2 = end handle (absolute), P3 = end point
 */
export function evaluateCubicBezier(
  t: number,
  p0: number,
  p1: number,
  p2: number,
  p3: number
): number {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;

  return mt3 * p0 + 3 * mt2 * t * p1 + 3 * mt * t2 * p2 + t3 * p3;
}

/**
 * Get the spline value at a specific position, considering all override points
 * This evaluates the piecewise bezier spline
 */
export function getSplineValue(
  channel: ChannelConfig,
  steps: string[],
  targetIndex: number,
  isHue: boolean = false
): number {
  const count = steps.length;
  if (count <= 1) return channel.start;

  // Build list of control points (overrides + start/end)
  const points: Array<{ index: number; x: number; y: number; handleIn?: SplineHandle; handleOut?: SplineHandle }> = [];

  // Add start point
  points.push({ index: -1, x: 0, y: channel.start });

  // Add override points
  steps.forEach((step, index) => {
    if (channel.overrides && step in channel.overrides) {
      const override = normalizeOverride(channel.overrides[step]);
      const x = index / (count - 1);
      points.push({
        index,
        x,
        y: override.value,
        handleIn: override.handleIn,
        handleOut: override.handleOut,
      });
    }
  });

  // Add end point
  points.push({ index: count, x: 1, y: channel.end });

  // Sort by x position
  points.sort((a, b) => a.x - b.x);

  // If target is an override point, return its value directly
  const targetX = targetIndex / (count - 1);
  const exactPoint = points.find(p => Math.abs(p.x - targetX) < 0.0001);
  if (exactPoint && exactPoint.index === targetIndex) {
    return exactPoint.y;
  }

  // Find which segment we're in
  let segmentStart = points[0];
  let segmentEnd = points[1];

  for (let i = 1; i < points.length; i++) {
    if (points[i].x >= targetX) {
      segmentStart = points[i - 1];
      segmentEnd = points[i];
      break;
    }
  }

  // Calculate local t within segment
  const segmentLength = segmentEnd.x - segmentStart.x;
  if (segmentLength === 0) return segmentStart.y;

  const localT = (targetX - segmentStart.x) / segmentLength;

  // Get or calculate handles
  let handleOut = segmentStart.handleOut;
  let handleIn = segmentEnd.handleIn;

  // Auto-calculate handles if not specified
  if (!handleOut) {
    const prevPoint = points[Math.max(0, points.indexOf(segmentStart) - 1)];
    if (segmentStart.index === -1) {
      // Start point
      handleOut = calculateEndpointHandles(segmentStart.x, segmentStart.y, segmentEnd.x, segmentEnd.y, true);
    } else {
      const handles = calculateAutoSmoothHandles(
        prevPoint.x, prevPoint.y,
        segmentStart.x, segmentStart.y,
        segmentEnd.x, segmentEnd.y
      );
      handleOut = handles.handleOut;
    }
  }

  if (!handleIn) {
    const nextPoint = points[Math.min(points.length - 1, points.indexOf(segmentEnd) + 1)];
    if (segmentEnd.index === count) {
      // End point
      handleIn = calculateEndpointHandles(segmentEnd.x, segmentEnd.y, segmentStart.x, segmentStart.y, false);
    } else {
      const handles = calculateAutoSmoothHandles(
        segmentStart.x, segmentStart.y,
        segmentEnd.x, segmentEnd.y,
        nextPoint.x, nextPoint.y
      );
      handleIn = handles.handleIn;
    }
  }

  // Convert relative handles to absolute control points
  const cp1y = segmentStart.y + (handleOut?.y ?? 0);
  const cp2y = segmentEnd.y + (handleIn?.y ?? 0);

  // Evaluate bezier
  return evaluateCubicBezier(localT, segmentStart.y, cp1y, cp2y, segmentEnd.y);
}

// Channel configuration (lightness, chroma, or hue)
export interface ChannelConfig {
  start: number;
  end: number;
  curve: CurveType;
  // Custom bezier control points [x1, y1, x2, y2] - used when curve is "custom"
  customBezier?: [number, number, number, number];
  // Per-step spline overrides with optional bezier handles
  overrides?: Record<string, OverrideValue>;
}

// A color family (e.g., "blue", "red", "primary")
export interface ColorFamily {
  name: string;
  lightness: ChannelConfig;
  chroma: ChannelConfig;
  hue: ChannelConfig;
}

// Channel sync configuration
// When a channel is synced, all families use the first family's curve for that channel
export interface SyncedChannels {
  lightness?: boolean;
  chroma?: boolean;
  hue?: boolean;
}

// Complete color scale configuration
// Steps are shared across all families
export interface ColorScaleConfig {
  steps: string[];  // Shared steps: ["50", "100", "200", ...]
  families: ColorFamily[];  // Multiple color families
  syncedChannels?: SyncedChannels;  // Which channels are synced across families
}

/**
 * Convert OKLCH values to hex color string
 * @param l Lightness (0-1)
 * @param c Chroma (0-0.4 roughly)
 * @param h Hue (0-360)
 */
export function oklchToHex(l: number, c: number, h: number): string {
  const color = oklch({ mode: "oklch", l, c, h });
  return formatHex(color) ?? "#000000";
}

/**
 * Convert hex color to OKLCH values
 * @param hex Hex color string (e.g., "#3B82F6")
 */
export function hexToOklch(hex: string): { l: number; c: number; h: number } {
  const parsed = parse(hex);
  if (!parsed) {
    return { l: 0.5, c: 0.1, h: 250 };
  }
  const color = oklch(parsed);
  if (!color) {
    return { l: 0.5, c: 0.1, h: 250 };
  }
  return {
    l: color.l ?? 0.5,
    c: color.c ?? 0.1,
    h: color.h ?? 250,
  };
}

// Cache easing functions to avoid recreating them
const easingCache = new Map<string, EasingFunction>();

/**
 * Get easing function for a curve, with support for custom bezier values
 */
export function getEasingFunctionWithCustom(
  curve: CurveType,
  customBezier?: [number, number, number, number]
): EasingFunction {
  if (curve === "linear") {
    return (t: number) => t;
  }
  if (curve === "custom" && customBezier) {
    return BezierEasing(customBezier[0], customBezier[1], customBezier[2], customBezier[3]);
  }
  const bezier = EASING_BEZIERS[curve];
  return BezierEasing(bezier[0], bezier[1], bezier[2], bezier[3]);
}

/**
 * Apply easing curve to a normalized value (0-1)
 * Uses bezier-easing for smooth, precise curves
 */
function applyCurve(
  t: number,
  curve: CurveType,
  customBezier?: [number, number, number, number]
): number {
  // For custom curves, we need a unique cache key
  const cacheKey = curve === "custom" && customBezier
    ? `custom-${customBezier.join("-")}`
    : curve;

  let easingFn = easingCache.get(cacheKey);
  if (!easingFn) {
    easingFn = getEasingFunctionWithCustom(curve, customBezier);
    easingCache.set(cacheKey, easingFn);
  }
  return easingFn(t);
}

/**
 * Interpolate between two values with curve easing
 * @param start Starting value
 * @param end Ending value
 * @param t Normalized position (0-1)
 * @param curve Easing curve type
 * @param customBezier Optional custom bezier values for "custom" curve type
 */
export function interpolate(
  start: number,
  end: number,
  t: number,
  curve: CurveType,
  customBezier?: [number, number, number, number]
): number {
  const easedT = applyCurve(t, curve, customBezier);
  return start + (end - start) * easedT;
}

/**
 * Interpolate hue values, handling the circular nature of hue
 * Takes the shortest path around the color wheel
 */
function interpolateHue(
  start: number,
  end: number,
  t: number,
  curve: CurveType,
  customBezier?: [number, number, number, number]
): number {
  // Normalize hues to 0-360
  start = ((start % 360) + 360) % 360;
  end = ((end % 360) + 360) % 360;

  // Find shortest path
  let diff = end - start;
  if (diff > 180) {
    diff -= 360;
  } else if (diff < -180) {
    diff += 360;
  }

  const easedT = applyCurve(t, curve, customBezier);
  let result = start + diff * easedT;

  // Normalize result
  return ((result % 360) + 360) % 360;
}

/**
 * Get the value for a channel at a specific step using monotonic spline
 * Active anchors are: start point, any overrides, end point
 * The curve smoothly passes through all active anchors
 */
export function getChannelValue(
  channel: ChannelConfig,
  step: string,
  stepIndex: number,
  totalSteps: number,
  isHue: boolean = false,
  allSteps?: string[]
): number {
  // If we have an override for this exact step, return it directly
  if (channel.overrides && step in channel.overrides) {
    return getOverrideValue(channel.overrides[step]);
  }

  if (totalSteps <= 1) return channel.start;

  // Build anchors from channel config using actual step names
  const steps = allSteps ?? Array.from({ length: totalSteps }, (_, i) => `${i}`);
  const anchors = buildChannelAnchors(channel, steps);

  // Evaluate spline at this position
  const x = stepIndex / (totalSteps - 1);
  let value = evaluateMonotonicSpline(anchors, x);

  // For hue, handle wrapping
  if (isHue) {
    value = ((value % 360) + 360) % 360;
  }

  return value;
}

/**
 * Get all channel values for a family (useful for curve visualization)
 * Uses monotonic spline interpolation through active anchors
 * Returns both the spline value and whether this point is an active anchor
 */
export function getChannelValues(
  channel: ChannelConfig,
  steps: string[],
  isHue: boolean = false
): Array<{
  step: string;
  value: number;
  isOverride: boolean;  // true = this point is an active anchor (user-adjusted)
  calculatedValue: number;  // What the spline calculates for this position
  handleIn?: SplineHandle;
  handleOut?: SplineHandle;
}> {
  const count = steps.length;
  if (count === 0) return [];

  // Build the active anchors (start + overrides + end)
  const anchors = buildChannelAnchors(channel, steps);

  return steps.map((step, index) => {
    const x = count <= 1 ? 0 : index / (count - 1);

    // Calculate the spline value at this position
    let calculatedValue = evaluateMonotonicSpline(anchors, x);
    if (isHue) {
      calculatedValue = ((calculatedValue % 360) + 360) % 360;
    }

    // Check if this is an active anchor (override)
    const hasOverride = channel.overrides && step in channel.overrides;

    // For first/last points, they're always "active" but shown differently
    const isFirst = index === 0;
    const isLast = index === count - 1;

    let value = calculatedValue;
    let handleIn: SplineHandle | undefined;
    let handleOut: SplineHandle | undefined;

    if (hasOverride) {
      const override = normalizeOverride(channel.overrides![step]);
      value = override.value;
      handleIn = override.handleIn;
      handleOut = override.handleOut;
    } else if (isFirst) {
      value = channel.start;
    } else if (isLast) {
      value = channel.end;
    }

    return {
      step,
      value,
      isOverride: hasOverride ?? false,
      calculatedValue,
      handleIn,
      handleOut,
    };
  });
}

/**
 * Generate colors for a single family across all steps
 * @param family The color family config
 * @param steps Array of step names
 * @param channelOverrides Optional channel configs to use instead of family's own (for sync)
 */
export function generateFamilyColors(
  family: ColorFamily,
  steps: string[],
  channelOverrides?: {
    lightness?: ChannelConfig;
    chroma?: ChannelConfig;
    hue?: ChannelConfig;
  }
): Array<{ step: string; hex: string; l: number; c: number; h: number }> {
  const count = steps.length;

  // Use override channels if provided, otherwise use family's own
  const lightnessConfig = channelOverrides?.lightness ?? family.lightness;
  const chromaConfig = channelOverrides?.chroma ?? family.chroma;
  const hueConfig = channelOverrides?.hue ?? family.hue;

  if (count === 0) return [];
  if (count === 1) {
    const l = lightnessConfig.start;
    const c = chromaConfig.start;
    const h = hueConfig.start;
    return [
      {
        step: steps[0],
        hex: oklchToHex(l, c, h),
        l, c, h,
      },
    ];
  }

  return steps.map((step, index) => {
    const l = getChannelValue(lightnessConfig, step, index, count, false, steps);
    const c = getChannelValue(chromaConfig, step, index, count, false, steps);
    const h = getChannelValue(hueConfig, step, index, count, true, steps);

    return {
      step,
      hex: oklchToHex(l, c, h),
      l, c, h,
    };
  });
}

/**
 * Generate all colors for a color scale config
 * Returns tokens with names like "blue.500", "red.100", etc.
 */
export function generateColorScale(
  config: ColorScaleConfig
): Array<{ name: string; hex: string }> {
  const allColors: Array<{ name: string; hex: string }> = [];

  if (!config.families || !Array.isArray(config.families)) {
    return allColors;
  }

  // Get synced channel overrides from first family
  const firstFamily = config.families[0];
  const syncedChannels = config.syncedChannels;

  for (const family of config.families) {
    // Build channel overrides based on sync settings
    const channelOverrides = firstFamily ? {
      lightness: syncedChannels?.lightness ? firstFamily.lightness : undefined,
      chroma: syncedChannels?.chroma ? firstFamily.chroma : undefined,
      hue: syncedChannels?.hue ? firstFamily.hue : undefined,
    } : undefined;

    const familyColors = generateFamilyColors(family, config.steps, channelOverrides);
    for (const { step, hex } of familyColors) {
      allColors.push({
        name: `${family.name}.${step}`,
        hex,
      });
    }
  }

  return allColors;
}

/**
 * Default channel configuration for a new family
 */
export const defaultChannelConfig: ChannelConfig = {
  start: 0.95,
  end: 0.25,
  curve: "quad-out",
};

/**
 * Create a new color family with default values
 */
export function createDefaultFamily(name: string, hue: number = 264): ColorFamily {
  // Default values tuned to produce Tailwind-like color scales
  // Tailwind characteristics:
  // - Very light at 50 (L ~0.97), dark at 950 (L ~0.25)
  // - Chroma peaks in mid-range (400-600), lower at extremes
  // - Smooth, perceptually uniform progression
  return {
    name,
    lightness: { start: 0.97, end: 0.25, curve: "ease-out" },
    chroma: { start: 0.025, end: 0.09, curve: "ease-in-out" },
    hue: { start: hue, end: hue, curve: "linear" },
  };
}

/**
 * Default color scale configuration
 */
export const defaultColorScaleConfig: ColorScaleConfig = {
  steps: ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"],
  families: [createDefaultFamily("blue", 264)], // 264 is close to Tailwind blue in OKLCH
};

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Validate and clamp color scale config values
 */
export function validateColorScaleConfig(config: ColorScaleConfig): ColorScaleConfig {
  return {
    steps: config.steps.length > 0 ? config.steps : ["500"],
    families: config.families.map((family) => ({
      name: family.name || "unnamed",
      lightness: {
        start: clamp(family.lightness.start, 0, 1),
        end: clamp(family.lightness.end, 0, 1),
        curve: family.lightness.curve,
      },
      chroma: {
        start: clamp(family.chroma.start, 0, 0.4),
        end: clamp(family.chroma.end, 0, 0.4),
        curve: family.chroma.curve,
      },
      hue: {
        start: ((family.hue.start % 360) + 360) % 360,
        end: ((family.hue.end % 360) + 360) % 360,
        curve: family.hue.curve,
      },
    })),
  };
}

/**
 * Convert hex to RGB values (0-255)
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

/**
 * Calculate relative luminance (WCAG 2.x)
 * Returns value between 0 (black) and 1 (white)
 * https://www.w3.org/WAI/GL/wiki/Relative_luminance
 */
export function getRelativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);

  // Convert to sRGB
  const rsRGB = r / 255;
  const gsRGB = g / 255;
  const bsRGB = b / 255;

  // Linearize
  const rLinear = rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
  const gLinear = gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
  const bLinear = bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);

  return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
}

/**
 * Calculate WCAG 2.x contrast ratio between two colors
 * Returns value between 1 (same color) and 21 (black vs white)
 */
export function getWcag2ContrastRatio(hex1: string, hex2: string): number {
  const l1 = getRelativeLuminance(hex1);
  const l2 = getRelativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Calculate APCA (WCAG 3) contrast
 * Returns Lc value (lightness contrast)
 * Positive = dark text on light bg, Negative = light text on dark bg
 * https://github.com/Myndex/SAPC-APCA
 */
export function getApcaContrast(textHex: string, bgHex: string): number {
  const { r: txtR, g: txtG, b: txtB } = hexToRgb(textHex);
  const { r: bgR, g: bgG, b: bgB } = hexToRgb(bgHex);

  // Linearize with sRGB TRC (using 2.4 exponent approximation)
  const linearize = (val: number) => Math.pow(val / 255, 2.4);

  const txtY = 0.2126729 * linearize(txtR) + 0.7151522 * linearize(txtG) + 0.0721750 * linearize(txtB);
  const bgY = 0.2126729 * linearize(bgR) + 0.7151522 * linearize(bgG) + 0.0721750 * linearize(bgB);

  // APCA constants
  const normBg = 0.56;
  const normTxt = 0.57;
  const revTxt = 0.62;
  const revBg = 0.65;
  const blkThrs = 0.022;
  const blkClmp = 1.414;
  const scaleBoW = 1.14;
  const scaleBob = 1.14;
  const loBoWoffset = 0.027;
  const loBobOffset = 0.027;

  // Clamp black levels
  const txtYc = txtY > blkThrs ? txtY : txtY + Math.pow(blkThrs - txtY, blkClmp);
  const bgYc = bgY > blkThrs ? bgY : bgY + Math.pow(blkThrs - bgY, blkClmp);

  // Calculate contrast
  let Lc = 0;
  if (bgYc > txtYc) {
    // Dark text on light background
    Lc = (Math.pow(bgYc, normBg) - Math.pow(txtYc, normTxt)) * scaleBoW;
    Lc = Lc < loBoWoffset ? 0 : Lc - loBoWoffset;
  } else {
    // Light text on dark background
    Lc = (Math.pow(bgYc, revBg) - Math.pow(txtYc, revTxt)) * scaleBob;
    Lc = Lc > -loBobOffset ? 0 : Lc + loBobOffset;
  }

  return Lc * 100;
}

/**
 * Solve for OKLCH lightness value that achieves target relative luminance
 * Uses binary search to find the L value
 * @param targetLuminance Target relative luminance (0-1)
 * @param c Chroma value
 * @param h Hue value
 * @param tolerance Acceptable error (default 0.0001)
 * @param maxIterations Max search iterations (default 50)
 */
export function solveLightnessForLuminance(
  targetLuminance: number,
  c: number,
  h: number,
  tolerance: number = 0.0001,
  maxIterations: number = 50
): number {
  // Clamp target to valid range
  targetLuminance = Math.max(0, Math.min(1, targetLuminance));

  let low = 0;
  let high = 1;
  let mid = 0.5;

  for (let i = 0; i < maxIterations; i++) {
    mid = (low + high) / 2;
    const hex = oklchToHex(mid, c, h);
    const luminance = getRelativeLuminance(hex);
    const diff = Math.abs(luminance - targetLuminance);

    if (diff < tolerance) {
      return mid;
    }

    // Higher L = higher luminance, so adjust search accordingly
    if (luminance < targetLuminance) {
      low = mid;
    } else {
      high = mid;
    }

    // If we've converged (low and high are very close), break
    if (high - low < 0.00001) {
      break;
    }
  }

  return mid;
}

/**
 * Solve for OKLCH lightness AND chroma to achieve target luminance
 * Will reduce chroma if needed to hit the exact luminance target
 * @returns { l, c } - the L value and potentially reduced C value
 */
export function solveLightnessAndChromaForLuminance(
  targetLuminance: number,
  maxChroma: number,
  h: number,
  tolerance: number = 0.0001
): { l: number; c: number } {
  // Clamp target to valid range
  targetLuminance = Math.max(0.0001, Math.min(0.9999, targetLuminance));

  // Try with full chroma first
  let c = maxChroma;
  let l = solveLightnessForLuminance(targetLuminance, c, h, tolerance);
  let hex = oklchToHex(l, c, h);
  let achievedLuminance = getRelativeLuminance(hex);

  // If we hit the target, we're done
  if (Math.abs(achievedLuminance - targetLuminance) < tolerance) {
    return { l, c };
  }

  // Otherwise, reduce chroma until we can hit the target
  // Binary search on chroma
  let lowC = 0;
  let highC = maxChroma;

  for (let i = 0; i < 20; i++) {
    c = (lowC + highC) / 2;
    l = solveLightnessForLuminance(targetLuminance, c, h, tolerance);
    hex = oklchToHex(l, c, h);
    achievedLuminance = getRelativeLuminance(hex);

    const diff = Math.abs(achievedLuminance - targetLuminance);
    if (diff < tolerance) {
      // Found a chroma that works, but try to use more chroma if possible
      lowC = c;
    } else {
      // Still can't hit target, need less chroma
      highC = c;
    }

    if (highC - lowC < 0.001) {
      break;
    }
  }

  // Final solve with the found chroma
  c = lowC; // Use the highest chroma that worked
  l = solveLightnessForLuminance(targetLuminance, c, h, tolerance);

  return { l, c };
}

// Gamut checking functions
const inP3Gamut = inGamut("p3");
const inSrgbGamut = inGamut("rgb");

/**
 * Check if an OKLCH color is within the P3 gamut
 */
export function isInP3Gamut(l: number, c: number, h: number): boolean {
  const color = { mode: "oklch" as const, l, c, h };
  return inP3Gamut(color);
}

/**
 * Check if an OKLCH color is within the sRGB gamut
 */
export function isInSrgbGamut(l: number, c: number, h: number): boolean {
  const color = { mode: "oklch" as const, l, c, h };
  return inSrgbGamut(color);
}

/**
 * Find the maximum chroma value that keeps the color within P3 gamut
 * Uses binary search for efficiency
 * @param l Lightness (0-1)
 * @param h Hue (0-360)
 * @param tolerance Precision of the search (default 0.001)
 */
export function maxChromaInP3(l: number, h: number, tolerance: number = 0.001): number {
  let lo = 0;
  let hi = 0.45; // P3 can have higher chroma than sRGB

  while (hi - lo > tolerance) {
    const mid = (lo + hi) / 2;
    if (isInP3Gamut(l, mid, h)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return lo;
}

/**
 * Find the maximum chroma value that keeps the color within sRGB gamut
 * Uses binary search for efficiency
 * @param l Lightness (0-1)
 * @param h Hue (0-360)
 * @param tolerance Precision of the search (default 0.001)
 */
export function maxChromaInSrgb(l: number, h: number, tolerance: number = 0.001): number {
  let lo = 0;
  let hi = 0.4;

  while (hi - lo > tolerance) {
    const mid = (lo + hi) / 2;
    if (isInSrgbGamut(l, mid, h)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return lo;
}

export type GamutMode = "p3" | "srgb";

/**
 * Find the maximum chroma for a given L and H within the specified gamut
 */
export function maxChromaInGamut(l: number, h: number, gamut: GamutMode = "p3"): number {
  return gamut === "p3" ? maxChromaInP3(l, h) : maxChromaInSrgb(l, h);
}

// =============================================================================
// THEME SEED: Auto-derive full palette from minimal color inputs
// =============================================================================

/**
 * Minimal seed input for generating a complete theme.
 * Only `primary` is required — all other colors are auto-derived if omitted.
 */
export interface ThemeSeed {
  primary: string;          // hex — main brand color (required)
  secondary?: string;       // hex — auto-derived: desaturated primary
  tertiary?: string;        // hex — auto-derived: +90° hue shift
  neutral?: string;         // hex — auto-derived: very low chroma tinted neutral
  neutralVariant?: string;  // hex — auto-derived: slightly more chroma than neutral
  error?: string;           // hex — defaults to #dc2626
  warning?: string;         // hex — defaults to #f59e0b
  success?: string;         // hex — defaults to #22c55e
  info?: string;            // hex — defaults to #3b82f6
}

/** Fully resolved theme colors (all fields populated) */
export interface ResolvedThemeColors {
  primary: { l: number; c: number; h: number };
  secondary: { l: number; c: number; h: number };
  tertiary: { l: number; c: number; h: number };
  neutral: { l: number; c: number; h: number };
  neutralVariant: { l: number; c: number; h: number };
  error: { l: number; c: number; h: number };
  warning: { l: number; c: number; h: number };
  success: { l: number; c: number; h: number };
  info: { l: number; c: number; h: number };
}

// Default semantic hex colors
const DEFAULT_ERROR = "#dc2626";
const DEFAULT_WARNING = "#f59e0b";
const DEFAULT_SUCCESS = "#22c55e";
const DEFAULT_INFO = "#3b82f6";

// Semantic base hues in OKLCH
const SEMANTIC_BASE_HUES = {
  error: 29,
  warning: 85,
  success: 155,
  info: 255,
} as const;

/**
 * Rotate a semantic hue slightly toward the brand hue for visual harmony.
 * Uses shortest-path rotation on the hue circle.
 *
 * @param semanticHue  The original semantic hue (OKLCH 0–360)
 * @param brandHue     The brand's primary hue
 * @param amount       Blend factor (0 = no change, 1 = fully match brand). Default 0.1
 */
export function harmonizeHue(
  semanticHue: number,
  brandHue: number,
  amount: number = 0.1
): number {
  let diff = brandHue - semanticHue;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return ((semanticHue + diff * amount) % 360 + 360) % 360;
}

/**
 * Nudge a semantic chroma toward the brand's chroma level.
 *
 * @param semanticChroma  Original chroma
 * @param brandChroma     Brand's primary chroma
 * @param amount          Blend factor (0–1). Default 0.15
 */
export function harmonizeChroma(
  semanticChroma: number,
  brandChroma: number,
  amount: number = 0.15
): number {
  return semanticChroma + (brandChroma - semanticChroma) * amount;
}

/**
 * Derive all theme colors from a ThemeSeed.
 * Only `primary` is required — everything else is computed.
 */
export function deriveThemeColors(seed: ThemeSeed): ResolvedThemeColors {
  const primary = hexToOklch(seed.primary);

  // Secondary: same hue, ⅓ chroma, mid lightness
  const secondary = seed.secondary
    ? hexToOklch(seed.secondary)
    : { l: 0.55, c: primary.c * 0.33, h: primary.h };

  // Tertiary: +90° hue, ¾ chroma
  const tertiary = seed.tertiary
    ? hexToOklch(seed.tertiary)
    : { l: 0.55, c: primary.c * 0.75, h: ((primary.h + 90) % 360 + 360) % 360 };

  // Neutral: tinted with very low chroma
  const neutral = seed.neutral
    ? hexToOklch(seed.neutral)
    : { l: 0.50, c: 0.015, h: primary.h };

  // Neutral variant: slightly more chroma
  const neutralVariant = seed.neutralVariant
    ? hexToOklch(seed.neutralVariant)
    : { l: 0.50, c: 0.025, h: primary.h };

  // Semantic colors with optional harmonization
  const errorBase = seed.error ? hexToOklch(seed.error) : hexToOklch(DEFAULT_ERROR);
  const warningBase = seed.warning ? hexToOklch(seed.warning) : hexToOklch(DEFAULT_WARNING);
  const successBase = seed.success ? hexToOklch(seed.success) : hexToOklch(DEFAULT_SUCCESS);
  const infoBase = seed.info ? hexToOklch(seed.info) : hexToOklch(DEFAULT_INFO);

  // Harmonize semantic hues toward brand (only for auto-derived colors)
  const error = seed.error
    ? errorBase
    : {
        l: errorBase.l,
        c: harmonizeChroma(errorBase.c, primary.c),
        h: harmonizeHue(SEMANTIC_BASE_HUES.error, primary.h),
      };

  const warning = seed.warning
    ? warningBase
    : {
        l: warningBase.l,
        c: harmonizeChroma(warningBase.c, primary.c),
        h: harmonizeHue(SEMANTIC_BASE_HUES.warning, primary.h),
      };

  const success = seed.success
    ? successBase
    : {
        l: successBase.l,
        c: harmonizeChroma(successBase.c, primary.c),
        h: harmonizeHue(SEMANTIC_BASE_HUES.success, primary.h),
      };

  const info = seed.info
    ? infoBase
    : {
        l: infoBase.l,
        c: harmonizeChroma(infoBase.c, primary.c),
        h: harmonizeHue(SEMANTIC_BASE_HUES.info, primary.h),
      };

  return { primary, secondary, tertiary, neutral, neutralVariant, error, warning, success, info };
}

/**
 * Create a ColorFamily config from a single OKLCH color.
 * Produces an 11-step scale that plugs directly into generateColorScale().
 */
export function colorFamilyFromOklch(
  name: string,
  color: { l: number; c: number; h: number }
): ColorFamily {
  return {
    name,
    lightness: { start: 0.97, end: 0.25, curve: "ease-in-out" as CurveType },
    chroma: { start: color.c * 0.3, end: color.c * 1.2, curve: "ease-out" as CurveType },
    hue: { start: color.h, end: color.h, curve: "linear" as CurveType },
  };
}

/**
 * Create a ColorFamily config from a hex color.
 */
export function colorFamilyFromHex(name: string, hex: string): ColorFamily {
  return colorFamilyFromOklch(name, hexToOklch(hex));
}

// =============================================================================
// ON-COLOR GENERATION: Auto-compute contrast text/icon colors
// =============================================================================

/**
 * Generate a contrast "on" color for a given base OKLCH color.
 * Picks light or dark text based on lightness threshold, keeps slight hue tint.
 */
export function generateOnColor(base: {
  l: number;
  c: number;
  h: number;
}): { l: number; c: number; h: number } {
  const onChroma = base.c * 0.15; // mostly neutral text
  if (base.l > 0.6) {
    return { l: 0.15, c: onChroma, h: base.h };
  } else {
    return { l: 0.95, c: onChroma, h: base.h };
  }
}

/**
 * Generate a contrast "on" color for a container (subtle bg).
 * Container text retains more chroma than regular on-color.
 */
export function generateOnContainerColor(container: {
  l: number;
  c: number;
  h: number;
}): { l: number; c: number; h: number } {
  return {
    l: container.l > 0.6 ? 0.20 : 0.90,
    c: container.c * 0.8,
    h: container.h,
  };
}

/**
 * Verify an on-color meets WCAG AA contrast (4.5:1) against its background,
 * and adjust lightness if needed.
 */
export function ensureOnColorContrast(
  onColor: { l: number; c: number; h: number },
  bgColor: { l: number; c: number; h: number },
  minRatio: number = 4.5
): { l: number; c: number; h: number } {
  const bgHex = oklchToHex(bgColor.l, bgColor.c, bgColor.h);
  const onHex = oklchToHex(onColor.l, onColor.c, onColor.h);
  const ratio = getWcag2ContrastRatio(bgHex, onHex);

  if (ratio >= minRatio) {
    return onColor;
  }

  // Binary search for a lightness that meets contrast
  const goLighter = bgColor.l < 0.5;
  let lo = goLighter ? onColor.l : 0;
  let hi = goLighter ? 1 : onColor.l;

  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const testHex = oklchToHex(mid, onColor.c, onColor.h);
    const testRatio = getWcag2ContrastRatio(bgHex, testHex);

    if (testRatio >= minRatio) {
      // Found a valid lightness — try to stay closer to original
      if (goLighter) {
        hi = mid;
      } else {
        lo = mid;
      }
    } else {
      if (goLighter) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
  }

  return { l: (lo + hi) / 2, c: onColor.c, h: onColor.h };
}

// =============================================================================
// DARK MODE TONE SELECTION
// =============================================================================

/**
 * Mapping of semantic role → scale step index for light and dark modes.
 * Steps correspond to the standard 11-step scale: [50,100,200,...,900,950]
 */
export const MD3_TONE_MAP = {
  light: {
    role:             5,  // 500
    onRole:           0,  // 50
    roleContainer:    1,  // 100
    onRoleContainer:  9,  // 900
  },
  dark: {
    role:             2,  // 200
    onRole:           9,  // 900
    roleContainer:    8,  // 800
    onRoleContainer:  1,  // 100
  },
} as const;

/**
 * Standard 11-step scale names used by DSB color collections
 */
export const STANDARD_STEPS = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"] as const;

