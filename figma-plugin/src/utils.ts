// Utility functions for value conversion

/**
 * A handful of CSS named colors the surfaces helper / hand-authored tokens
 * commonly resolve to. Not exhaustive — the long tail is rare in token
 * values and would just bloat the bundle.
 */
const NAMED_COLORS: Record<string, string> = {
  transparent: "#00000000",
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  yellow: "#ffff00",
  orange: "#ffa500",
  purple: "#800080",
  navy: "#000080",
};

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** sRGB gamma encode a linear-light channel (0..1). */
function linearToSrgb(c: number): number {
  const x = clamp01(c);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/**
 * Convert an OKLCH (or OKLab, when h is undefined) color to sRGB 0..1.
 * Self-contained so the plugin needs no color library in the Figma sandbox.
 */
function oklchToRgb(L: number, C: number, H: number): { r: number; g: number; b: number } {
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const rLin = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bLin = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return {
    r: linearToSrgb(rLin),
    g: linearToSrgb(gLin),
    b: linearToSrgb(bLin),
  };
}

/** Convert HSL (h in deg, s/l in 0..1) to sRGB 0..1. */
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0,
    g = 0,
    b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const mAdj = l - c / 2;
  return { r: r + mAdj, g: g + mAdj, b: b + mAdj };
}

/** Pull the comma/space/slash-separated args out of a `fn(...)` color. */
function parseColorArgs(body: string): { nums: number[]; alpha: number } {
  // Split on the optional `/ alpha` first, then on commas/whitespace.
  const [main, alphaPart] = body.split("/");
  const nums = main
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((t) => (t.endsWith("%") ? parseFloat(t) / 100 : parseFloat(t)));
  let alpha = 1;
  if (alphaPart !== undefined) {
    const a = alphaPart.trim();
    alpha = a.endsWith("%") ? parseFloat(a) / 100 : parseFloat(a);
  }
  return { nums, alpha };
}

/**
 * Parse an arbitrary CSS color string into Figma RGBA (channels 0..1).
 * Handles hex (3/6/8-digit), rgb()/rgba(), hsl()/hsla(), oklch()/oklab(),
 * and a few named colors. Returns null if the value can't be parsed or
 * resolves to NaN — callers should skip rather than write a broken value.
 */
export function parseColorToRGBA(input: string): RGBA | null {
  if (typeof input !== "string") return null;
  let str = input.trim().toLowerCase();
  if (!str) return null;

  if (NAMED_COLORS[str]) str = NAMED_COLORS[str];

  let rgba: RGBA | null = null;

  if (str[0] === "#") {
    let hex = str.slice(1);
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    if (hex.length === 4) hex = hex.split("").map((c) => c + c).join("");
    if (hex.length === 6 || hex.length === 8) {
      rgba = {
        r: parseInt(hex.slice(0, 2), 16) / 255,
        g: parseInt(hex.slice(2, 4), 16) / 255,
        b: parseInt(hex.slice(4, 6), 16) / 255,
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
  } else {
    const fn = str.match(/^([a-z]+)\((.*)\)$/);
    if (fn) {
      const name = fn[1];
      const { nums, alpha } = parseColorArgs(fn[2]);
      if (name === "rgb" || name === "rgba") {
        // Channels are 0..255 ints, except percent tokens which `parseColorArgs`
        // already normalized to 0..1 — scale those back up so /255 is uniform.
        const rawTokens = fn[2].split("/")[0].trim().split(/[\s,]+/).filter(Boolean);
        const chan = (i: number) =>
          (rawTokens[i]?.endsWith("%") ? nums[i] * 255 : nums[i]) / 255;
        rgba = {
          r: chan(0),
          g: chan(1),
          b: chan(2),
          a: nums.length > 3 ? nums[3] : alpha,
        };
      } else if (name === "hsl" || name === "hsla") {
        const { r, g, b } = hslToRgb(nums[0], nums[1], nums[2]);
        rgba = { r, g, b, a: nums.length > 3 ? nums[3] : alpha };
      } else if (name === "oklch" || name === "oklab") {
        // L may be authored as 0..1 or a percentage (already /100 above).
        const L = nums[0];
        const C = nums[1];
        const H = name === "oklch" ? nums[2] : Math.atan2(nums[2], nums[1]) * (180 / Math.PI);
        const cc = name === "oklch" ? C : Math.hypot(nums[1], nums[2]);
        const { r, g, b } = oklchToRgb(L, cc, H || 0);
        rgba = { r: clamp01(r), g: clamp01(g), b: clamp01(b), a: nums.length > 3 ? nums[3] : alpha };
      }
    }
  }

  if (!rgba) return null;
  if (
    Number.isNaN(rgba.r) ||
    Number.isNaN(rgba.g) ||
    Number.isNaN(rgba.b) ||
    Number.isNaN(rgba.a)
  ) {
    return null;
  }
  return rgba;
}

/**
 * Convert a color string to Figma RGBA. Backwards-compatible wrapper around
 * {@link parseColorToRGBA}; falls back to opaque black for unparseable input
 * (callers that need to skip should use `parseColorToRGBA` directly).
 */
export function hexToFigmaRGBA(hex: string): RGBA {
  return parseColorToRGBA(hex) ?? { r: 0, g: 0, b: 0, a: 1 };
}

/**
 * Convert Figma RGBA to hex color string
 */
export function figmaRGBAToHex(rgba: RGBA): string {
  const r = Math.round(rgba.r * 255).toString(16).padStart(2, "0");
  const g = Math.round(rgba.g * 255).toString(16).padStart(2, "0");
  const b = Math.round(rgba.b * 255).toString(16).padStart(2, "0");

  if (rgba.a !== 1) {
    const a = Math.round(rgba.a * 255).toString(16).padStart(2, "0");
    return `#${r}${g}${b}${a}`.toUpperCase();
  }

  return `#${r}${g}${b}`.toUpperCase();
}

// DTCG-aligned token types
type TokenType =
  | "color"
  | "dimension"
  | "fontFamily"
  | "fontWeight"
  | "duration"
  | "cubicBezier"
  | "number"
  | "shadow"
  | "border"
  | "typography"
  | "gradient"
  | "string"
  | "boolean";

/**
 * Map DTCG token type to Figma variable resolved type
 * Figma only supports: COLOR, FLOAT, STRING, BOOLEAN
 */
export function mapTypeToFigma(type?: TokenType): VariableResolvedDataType {
  switch (type) {
    case "color":
      return "COLOR";
    case "dimension":
    case "duration":
    case "fontWeight":
    case "number":
      return "FLOAT";
    case "fontFamily":
    case "cubicBezier":
    case "shadow":
    case "border":
    case "typography":
    case "gradient":
    case "string":
      return "STRING";
    case "boolean":
      return "BOOLEAN";
    default:
      return "STRING"; // Default to STRING for unknown types
  }
}

/**
 * Infer DTCG type from collection kind
 */
export function inferTypeFromKind(kind?: "regular" | "color" | "spacing" | "typography" | "fluid"): TokenType {
  switch (kind) {
    case "color":
      return "color";
    case "spacing":
    case "typography":
    case "fluid":
      return "dimension"; // All fluid-based tokens are dimension values
    default:
      return "string"; // Default to string for regular/unknown collections
  }
}

/**
 * Infer DTCG type from a raw value
 */
export function inferTypeFromValue(value: unknown): TokenType {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") {
    // Check if it's a color (hex format)
    if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(value)) {
      return "color";
    }
    // Check if it's a dimension (has unit or clamp)
    if (/^(\d+(\.\d+)?(px|rem|em|%)|clamp\()/.test(value)) {
      return "dimension";
    }
    // Check if it's a duration
    if (/^\d+(\.\d+)?(ms|s)$/.test(value)) {
      return "duration";
    }
  }
  return "string";
}

/**
 * Convert a raw value to Figma variable value
 * Maps DTCG types to Figma's supported types
 */
export function convertValueToFigma(
  value: string | number | boolean,
  type: TokenType
): VariableValue {
  switch (type) {
    case "color": {
      const rgba = parseColorToRGBA(String(value));
      if (!rgba) {
        throw new Error(
          `Unsupported color value "${String(value)}" — expected hex, rgb(), hsl(), oklch(), or a named color`
        );
      }
      return rgba;
    }
    case "dimension":
    case "duration":
    case "fontWeight":
    case "number":
      // Extract numeric value - Figma variables only support numbers
      if (typeof value === "number") return value;
      const numMatch = String(value).match(/^(\d+(\.\d+)?)/);
      return numMatch ? parseFloat(numMatch[1]) : 0;
    case "boolean":
      return typeof value === "boolean" ? value : value === "true";
    case "fontFamily":
    case "cubicBezier":
    case "shadow":
    case "border":
    case "typography":
    case "gradient":
    case "string":
    default:
      return String(value);
  }
}
