/**
 * Pure generator computation — GeneratorDef → generated TokenDocs.
 *
 * Port of the cloud product's server-side compute
 * (web/convex/lib/generatorCompute.ts) plus the name mapping its
 * mutations applied at write time (web/convex/collections.ts,
 * `applyGeneratorRegeneration`):
 *   - color: `generateColorScale` output is used as-is ("blue.500")
 *   - spacing/typography: the config `prefix` is stripped — the
 *     generator's `groupPrefix` re-applies it
 *   - final name = groupPrefix ? `${groupPrefix}.${name}` : name
 *   - every collection mode gets the same raw value
 *
 * Everything here is pure: the store orchestrates when to recompute
 * (on load and on every config change) and merges the results into the
 * collection's token list. Surfaces materialization is NOT handled
 * here — see core/surfaces-utils' `generateSurfaceTokens`.
 */

import type {
  CollectionDoc,
  GeneratorConfig,
  GeneratorDef,
  SystemDoc,
  TokenDoc,
  TokenType,
  TokenValue,
} from "./types";
import { generateColorScale } from "./color-utils";
import {
  generateSpacingScale,
  generateTypeScale,
  type ViewportConfig,
} from "./fluid-utils";

/** Fallback when the system has no fluid viewport configured. */
export const DEFAULT_VIEWPORT: ViewportConfig = {
  minWidth: 360,
  maxWidth: 1240,
};

export interface ComputedGeneratorToken {
  /** Name WITHOUT the generator's groupPrefix (applied by the caller). */
  name: string;
  value: string | number;
  type?: TokenType;
  minPx?: number;
  maxPx?: number;
}

function stripPrefix(name: string, prefix: string): string {
  return prefix && name.startsWith(prefix + ".")
    ? name.slice(prefix.length + 1)
    : name;
}

/**
 * Compute the raw generated tokens for a generator config. Names are
 * prefix-stripped exactly like the cloud editors' save handlers; the
 * `groupPrefix` is re-applied by `computeGeneratorTokenDocs`.
 */
export function computeGeneratorTokens(
  config: GeneratorConfig,
  viewport: ViewportConfig
): ComputedGeneratorToken[] {
  if (config.type === "color") {
    return generateColorScale(config.colorScaleConfig).map((c) => ({
      name: c.name,
      value: c.hex,
      type: "color" as const,
    }));
  }
  if (config.type === "spacing") {
    const spacingConfig = config.spacingConfig;
    return generateSpacingScale(spacingConfig, viewport).map((t) => ({
      name: stripPrefix(t.name, spacingConfig.prefix),
      value: t.value,
      type: "dimension" as const,
      minPx: t.minPx,
      maxPx: t.maxPx,
    }));
  }
  const typographyConfig = config.typographyConfig;
  return generateTypeScale(typographyConfig, viewport).map((t) => ({
    name: stripPrefix(t.name, typographyConfig.prefix),
    value: t.value,
    type: "dimension" as const,
    minPx: t.minPx,
    maxPx: t.maxPx,
  }));
}

/**
 * Materialize one generator's output as `generated: true` TokenDocs.
 * The full name is `groupPrefix.stepName` (or the bare step name for an
 * empty prefix); every mode in `modes` receives the same raw value —
 * mirroring the cloud's `applyGeneratorRegeneration` write shape.
 */
export function computeGeneratorTokenDocs(
  generator: GeneratorDef,
  viewport: ViewportConfig,
  modes: string[]
): TokenDoc[] {
  const prefix = generator.groupPrefix;
  return computeGeneratorTokens(generator.config, viewport).map((t) => {
    const values: Record<string, TokenValue> = {};
    for (const mode of modes) {
      values[mode] = { type: "raw", value: t.value };
    }
    const doc: TokenDoc = {
      name: prefix ? `${prefix}.${t.name}` : t.name,
      type: t.type,
      values,
      generated: true,
    };
    if (t.minPx !== undefined) doc.minPx = t.minPx;
    if (t.maxPx !== undefined) doc.maxPx = t.maxPx;
    return doc;
  });
}

/**
 * Run every generator of a collection and return the combined generated
 * TokenDocs (in generator order, steps in scale order). Does NOT include
 * surfaces-helper tokens — the store orchestrates those separately.
 */
export function computeGeneratedForCollection(
  collection: CollectionDoc,
  system: SystemDoc
): TokenDoc[] {
  const viewport = system.fluid?.viewport ?? DEFAULT_VIEWPORT;
  const out: TokenDoc[] = [];
  for (const generator of collection.generators ?? []) {
    out.push(...computeGeneratorTokenDocs(generator, viewport, collection.modes));
  }
  return out;
}
