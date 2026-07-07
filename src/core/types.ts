/**
 * Canonical document model — identity by name.
 *
 * Unlike the cloud product (which keys every reference on a Convex
 * `Id<"tokens">`), token-vault references tokens by their **dotted
 * name** (`"color.blue.600"`), globally unique across the design
 * system. Names are what the source files store, what DTCG aliases
 * (`"{color.blue.600}"`) already use, and what humans read in diffs.
 * Renames therefore cascade through references — see the store's
 * `rewriteRefs`.
 */

import type { ColorScaleConfig } from "./color-utils";
import type {
  SpacingScaleConfig,
  TypeScaleConfig,
  ViewportConfig,
} from "./fluid-utils";

/** A reference to a token by dotted name, e.g. "color.blue.600". */
export type TokenRef = string;

/** Collection reference = the collection's name (also its filename). */
export type CollectionRef = string;

// ============================================================================
// TOKEN VALUES — the six variants, mirroring the cloud schema's union
// (web/convex/schema.ts tokens.values) with name-based references.
// ============================================================================

export type RawValue = {
  type: "raw";
  value: string | number | boolean;
};

export type AliasValue = {
  type: "alias";
  token: TokenRef;
};

/**
 * A Tailwind v4 default-theme reference. The `color` field holds the
 * Tailwind utility name — either a palette color ("slate-500") or a
 * non-color scale utility ("font-bold", "leading-tight", "text-lg",
 * "spacing-4"). The field keeps the name `color` for back-compat with
 * derivations and the DTCG export; resolution disambiguates by ref shape.
 */
export type TailwindValue = {
  type: "tailwind";
  color: string;
};

export type DerivedValue = {
  type: "derived";
  base: DerivationBase;
  ops: DerivationOp[];
};

/**
 * A dimension computed from other tokens. The formula's identifiers ARE
 * token refs (dotted names) — there is no separate ref map like the
 * cloud's `tokenRefs`; renames rewrite the formula text.
 */
export type ExpressionValue = {
  type: "expression";
  formula: string;
};

/**
 * Composite (DTCG) value: named slots, each raw or alias. Layered
 * composites (multi-layer shadows, gradient stops) use the array form.
 */
export type CompositeSlot = RawValue | AliasValue | TailwindValue;
export type CompositeLayer = Record<string, CompositeSlot>;
export type CompositeValue = {
  type: "composite";
  layers: CompositeLayer | CompositeLayer[];
};

export type TokenValue =
  | RawValue
  | AliasValue
  | TailwindValue
  | DerivedValue
  | ExpressionValue
  | CompositeValue;

// ============================================================================
// DERIVATION — OKLCH op pipeline (name-based mirror of core/derivation)
// ============================================================================

export type DerivationBase =
  | { kind: "token"; token: TokenRef }
  | { kind: "tailwind"; color: string }
  | { kind: "raw"; value: string };

export type DerivationOp =
  | { op: "lighten"; amount: number }
  | { op: "darken"; amount: number }
  | { op: "mute"; amount: number }
  | { op: "mix"; with: TokenRef; weight: number }
  | {
      op: "autoContrast";
      light?: TokenRef;
      dark?: TokenRef;
      threshold?: number;
    }
  | { op: "shift"; stepStrength: number; chromaDelta?: number };

// ============================================================================
// DOCUMENTS
// ============================================================================

export type TokenType =
  | "color"
  | "dimension"
  | "fontFamily"
  | "fontWeight"
  | "duration"
  | "cubicBezier"
  | "transition"
  | "number"
  | "shadow"
  | "border"
  | "typography"
  | "gradient"
  | "string"
  | "boolean";

export interface TokenDoc {
  /** Dotted name, globally unique. Doubles as the token's identity. */
  name: TokenRef;
  type?: TokenType;
  /** Per-mode values. Single-mode collections use the "default" key. */
  values: Record<string, TokenValue>;
  description?: string;
  /**
   * True for tokens materialized from a generator or surfaces config.
   * Generated tokens are NEVER persisted to source files — the store
   * recomputes them on load and on every config change.
   */
  generated?: boolean;
  /** Fluid endpoints, recomputed (never persisted). */
  minPx?: number;
  maxPx?: number;
}

export type GeneratorConfig =
  | { type: "color"; colorScaleConfig: ColorScaleConfig }
  | { type: "spacing"; spacingConfig: SpacingScaleConfig }
  | { type: "typography"; typographyConfig: TypeScaleConfig };

export interface GeneratorDef {
  id: string;
  type: GeneratorConfig["type"];
  groupPrefix: string;
  config: GeneratorConfig;
}

export interface TailwindExtensionConfig {
  enabled: boolean;
  utility?: "spacing";
  semantic?: { modeSelectors: Record<string, string> };
}

export interface CollectionDoc {
  /** Collection name = source filename (collections/<name>.json). */
  name: CollectionRef;
  modes: string[];
  groupOrder?: string[];
  generators?: GeneratorDef[];
  /** Surfaces/themes helper config — name-based (see core/surfaces-utils). */
  surfacesConfig?: unknown; // narrowed by surfaces-utils' SurfacesConfig
  tailwind?: TailwindExtensionConfig;
  /** Source (hand-authored) tokens, in display order. */
  tokens: TokenDoc[];
}

export interface SystemDoc {
  name: string;
  description?: string;
  fluid: { viewport: ViewportConfig; breakpoints: number[] };
  useTailwindColors?: boolean;
  /**
   * Materialize `$tw` references as a synthetic read-only "Tailwind"
   * Figma variable collection on sync, alias-linking the referencing
   * tokens instead of baking them to raw.
   *   · "off"  (default) — bake `$tw` to raw (legacy behavior)
   *   · "used" — emit only the referenced Tailwind vars (tree-shaken)
   *   · "full" — emit the entire Tailwind default theme
   */
  tailwindFigmaBridge?: "off" | "used" | "full";
  exportLayout?: "single" | "per-collection";
  /** Collection names in display order (= files under collections/). */
  collections: CollectionRef[];
}

/**
 * A fully loaded + recomputed design system: source documents plus the
 * materialized `generated` tokens, ready for the editor/exporter.
 */
export interface SystemSnapshot {
  system: SystemDoc;
  collections: CollectionDoc[];
  /** Monotonic revision, bumped on every store change. */
  rev: number;
}
