/**
 * Tailwind → Figma bridge.
 *
 * When a design system is "mixed" (its own tokens *plus* references to
 * Tailwind's default theme via `{"$tw": …}`), we don't want to bake those
 * refs to raw on the Figma sync — that loses the link. Instead we
 * materialize a synthetic, read-only **Tailwind** variable collection and
 * alias-link the referencing tokens to it, so designers see the real
 * chain (`semantic/… → Tailwind/font-weight/bold`) without ever
 * re-authoring a single Tailwind class.
 *
 * This module maps a Tailwind ref (color or utility) to the synthetic
 * variable that represents it. It's pure data — `server/figma.ts` decides
 * *which* vars to emit (tree-shaken "used" set vs the "full" theme).
 */

import type { TokenType } from "./types";
import { getTailwindColor, TAILWIND_COLORS } from "./tailwind-colors";
import {
  findTailwindEntry,
  TAILWIND_THEME,
  type TailwindThemeEntry,
  type TailwindThemeScale,
} from "./tailwind-theme";

export interface BridgeVar {
  /**
   * Stable, collision-proof identity (`tw/<group>/<suffix>`). Doubles as
   * the alias `tokenId` and the `.figma-ids.json` key.
   */
  id: string;
  /** Display path inside the Tailwind collection, e.g. "color/slate/500". */
  name: string;
  /** token-vault type → drives the Figma variable type (COLOR/FLOAT/STRING). */
  type: TokenType;
  /** Raw resolved value (hex / rem / number string). */
  value: string;
}

function colorVar(c: {
  family: string;
  shade: string;
  hex: string;
}): BridgeVar {
  return {
    id: `tw/color/${c.family}/${c.shade}`,
    name: `color/${c.family}/${c.shade}`,
    type: "color",
    value: c.hex,
  };
}

function utilVar(scale: TailwindThemeScale, entry: TailwindThemeEntry): BridgeVar {
  return {
    id: `tw/${scale.figmaGroup}/${entry.suffix}`,
    name: `${scale.figmaGroup}/${entry.suffix}`,
    type: scale.type,
    value: entry.value,
  };
}

/** Synthetic Tailwind variable for a `$tw` ref (color or utility), or null. */
export function bridgeVarForRef(ref: string): BridgeVar | null {
  const c = getTailwindColor(ref);
  if (c) return colorVar(c);
  const f = findTailwindEntry(ref);
  if (f) return utilVar(f.scale, f.entry);
  return null;
}

/** Every Tailwind default-theme variable (the "full" import set). */
export function allBridgeVars(): BridgeVar[] {
  return [
    ...TAILWIND_COLORS.map(colorVar),
    ...TAILWIND_THEME.flatMap((s) => s.entries.map((e) => utilVar(s, e))),
  ];
}

/** The synthetic collection name used for all bridge variables. */
export const TAILWIND_BRIDGE_COLLECTION = "Tailwind";
