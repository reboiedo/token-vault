/**
 * Tailwind CSS v4 default theme scales — the NON-color half of the
 * palette (font-weight, line-height, letter-spacing, font-size, spacing,
 * radius, blur, breakpoints, container, shadow).
 *
 * These back the same `{"$tw": "…"}` reference kind that
 * `tailwind-colors.ts` powers for colors, so a token can lean on
 * Tailwind's existing utility scales instead of re-deriving them:
 *
 *   {"$tw": "font-bold"}      → 700
 *   {"$tw": "leading-tight"}  → 1.25
 *   {"$tw": "tracking-wide"}  → 0.025em
 *   {"$tw": "text-lg"}        → 1.125rem
 *   {"$tw": "spacing-4"}      → 1rem
 *
 * The reference string IS the Tailwind utility class name, so it never
 * collides with the `family-shade` color refs (blue-600, slate-500).
 * Reference: https://tailwindcss.com/docs/theme#default-theme-variable-reference
 */

import type { TokenType } from "./types";

export interface TailwindThemeEntry {
  /** Utility class name, e.g. "font-bold" — this is the `$tw` ref. */
  ref: string;
  /** The scale-relative key, e.g. "bold", "tight", "lg", "4". */
  suffix: string;
  /** Resolved CSS value, e.g. "700", "1.25", "0.025em", "1.125rem". */
  value: string;
  /** Tailwind v4 theme variable form, kept for DTCG export tooling. */
  cssVar: string;
}

export interface TailwindThemeScale {
  /** Stable id, e.g. "fontWeight". */
  namespace: string;
  /** Human label for the picker, e.g. "Font weight". */
  label: string;
  /** The token-vault token type this scale maps onto. */
  type: TokenType;
  /** Tailwind's CSS-var namespace, used as the Figma variable group. */
  figmaGroup: string;
  entries: TailwindThemeEntry[];
}

/** Build entries from a `{ suffix: value }` map with a shared prefix/var. */
function scale(
  namespace: string,
  label: string,
  type: TokenType,
  classPrefix: string,
  varPrefix: string,
  values: Record<string, string>
): TailwindThemeScale {
  return {
    namespace,
    label,
    type,
    figmaGroup: varPrefix,
    entries: Object.entries(values).map(([suffix, value]) => ({
      ref: `${classPrefix}-${suffix}`,
      suffix,
      value,
      cssVar: `var(--${varPrefix}-${suffix})`,
    })),
  };
}

// ---- font-weight ---------------------------------------------------------
const fontWeight = scale(
  "fontWeight",
  "Font weight",
  "fontWeight",
  "font",
  "font-weight",
  {
    thin: "100",
    extralight: "200",
    light: "300",
    normal: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
    extrabold: "800",
    black: "900",
  }
);

// ---- line-height (leading) ----------------------------------------------
const lineHeight = scale("lineHeight", "Line height", "number", "leading", "leading", {
  none: "1",
  tight: "1.25",
  snug: "1.375",
  normal: "1.5",
  relaxed: "1.625",
  loose: "2",
});

// ---- letter-spacing (tracking) ------------------------------------------
const letterSpacing = scale(
  "letterSpacing",
  "Letter spacing",
  "dimension",
  "tracking",
  "tracking",
  {
    tighter: "-0.05em",
    tight: "-0.025em",
    normal: "0em",
    wide: "0.025em",
    wider: "0.05em",
    widest: "0.1em",
  }
);

// ---- font-size (text) ----------------------------------------------------
const fontSize = scale("fontSize", "Font size", "dimension", "text", "text", {
  xs: "0.75rem",
  sm: "0.875rem",
  base: "1rem",
  lg: "1.125rem",
  xl: "1.25rem",
  "2xl": "1.5rem",
  "3xl": "1.875rem",
  "4xl": "2.25rem",
  "5xl": "3rem",
  "6xl": "3.75rem",
  "7xl": "4.5rem",
  "8xl": "6rem",
  "9xl": "8rem",
});

// ---- radius (rounded) ----------------------------------------------------
const radius = scale("radius", "Border radius", "dimension", "rounded", "radius", {
  none: "0px",
  xs: "0.125rem",
  sm: "0.25rem",
  md: "0.375rem",
  lg: "0.5rem",
  xl: "0.75rem",
  "2xl": "1rem",
  "3xl": "1.5rem",
  "4xl": "2rem",
  full: "calc(infinity * 1px)",
});

// ---- blur ----------------------------------------------------------------
const blur = scale("blur", "Blur", "dimension", "blur", "blur", {
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "24px",
  "2xl": "40px",
  "3xl": "64px",
});

// ---- breakpoints ---------------------------------------------------------
const breakpoint = scale("breakpoint", "Breakpoint", "dimension", "breakpoint", "breakpoint", {
  sm: "40rem",
  md: "48rem",
  lg: "64rem",
  xl: "80rem",
  "2xl": "96rem",
});

// ---- container widths ----------------------------------------------------
const container = scale("container", "Container width", "dimension", "container", "container", {
  "3xs": "16rem",
  "2xs": "18rem",
  xs: "20rem",
  sm: "24rem",
  md: "28rem",
  lg: "32rem",
  xl: "36rem",
  "2xl": "42rem",
  "3xl": "48rem",
  "4xl": "56rem",
  "5xl": "64rem",
  "6xl": "72rem",
  "7xl": "80rem",
});

// ---- shadow (box-shadow strings) ----------------------------------------
const shadow = scale("shadow", "Box shadow", "shadow", "shadow", "shadow", {
  "2xs": "0 1px rgb(0 0 0 / 0.05)",
  xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
  sm: "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
  md: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
  lg: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
  xl: "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
  "2xl": "0 25px 50px -12px rgb(0 0 0 / 0.25)",
});

// ---- spacing (multiples of --spacing: 0.25rem) --------------------------
// Named steps as Tailwind exposes them; value = step * 0.25rem.
const SPACING_STEPS = [
  0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20,
  24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96,
];
const spacing: TailwindThemeScale = {
  namespace: "spacing",
  label: "Spacing",
  type: "dimension",
  figmaGroup: "spacing",
  entries: [
    { ref: "spacing-px", suffix: "px", value: "1px", cssVar: "1px" },
    ...SPACING_STEPS.map((step) => ({
      ref: `spacing-${step}`,
      suffix: String(step),
      value: step === 0 ? "0px" : `${step * 0.25}rem`,
      cssVar: step === 0 ? "0px" : `calc(var(--spacing) * ${step})`,
    })),
  ],
};

/** All Tailwind v4 default-theme scales, in picker display order. */
export const TAILWIND_THEME: TailwindThemeScale[] = [
  fontWeight,
  lineHeight,
  letterSpacing,
  fontSize,
  spacing,
  radius,
  blur,
  breakpoint,
  container,
  shadow,
];

// Flat lookup: ref → { value, type, cssVar, namespace }.
const BY_REF = new Map<
  string,
  { value: string; type: TokenType; cssVar: string; namespace: string }
>();
for (const s of TAILWIND_THEME) {
  for (const e of s.entries) {
    BY_REF.set(e.ref, {
      value: e.value,
      type: s.type,
      cssVar: e.cssVar,
      namespace: s.namespace,
    });
  }
}

/**
 * Resolve a Tailwind utility ref (e.g. "font-bold", "leading-tight") to
 * its default-theme value, or null when the ref isn't a known utility.
 */
export function getTailwindUtility(
  ref: string
): { value: string; type: TokenType; cssVar: string; namespace: string } | null {
  return BY_REF.get(ref) ?? null;
}

/** True when `ref` names a Tailwind default-theme utility (not a color). */
export function isTailwindUtility(ref: string): boolean {
  return BY_REF.has(ref);
}

// Flat lookup: ref → { scale, entry } (keeps suffix/group for the Figma bridge).
const ENTRY_BY_REF = new Map<
  string,
  { scale: TailwindThemeScale; entry: TailwindThemeEntry }
>();
for (const s of TAILWIND_THEME) {
  for (const e of s.entries) ENTRY_BY_REF.set(e.ref, { scale: s, entry: e });
}

/** Locate the scale + entry for a utility ref, or null. */
export function findTailwindEntry(
  ref: string
): { scale: TailwindThemeScale; entry: TailwindThemeEntry } | null {
  return ENTRY_BY_REF.get(ref) ?? null;
}

/** Scales whose token type is compatible with any of `types` (picker filter). */
export function tailwindScalesForTypes(
  types: readonly TokenType[]
): TailwindThemeScale[] {
  return TAILWIND_THEME.filter((s) => types.includes(s.type));
}

/** Scales matching the given namespaces, e.g. for a specific composite slot. */
export function tailwindScalesByNamespace(
  namespaces: readonly string[]
): TailwindThemeScale[] {
  return TAILWIND_THEME.filter((s) => namespaces.includes(s.namespace));
}

/** Composite typography slot → the Tailwind scale namespaces that fit it. */
export const TAILWIND_SLOT_NAMESPACES: Record<string, string[]> = {
  fontSize: ["fontSize"],
  fontWeight: ["fontWeight"],
  letterSpacing: ["letterSpacing"],
  lineHeight: ["lineHeight"],
};
