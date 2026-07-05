/**
 * Effective collection kind + icon, ported from the cloud's
 * collections-nav.tsx: generators win (mono-type → that type, mixed →
 * generic), then surfacesConfig → themes, else regular.
 */

import {
  Hash,
  Palette,
  Ruler,
  SwatchBook,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { CollectionDoc } from "@core/types";

export type EffectiveKind =
  | "regular"
  | "color"
  | "spacing"
  | "typography"
  | "themes";

export function getEffectiveKind(c: CollectionDoc): EffectiveKind {
  if (c.surfacesConfig) return "themes";
  const types = new Set((c.generators ?? []).map((g) => g.type));
  if (types.size === 1) return [...types][0] as EffectiveKind;
  if (types.size > 1) return "regular";
  if (c.modes.length > 1) return "themes";
  return "regular";
}

export const KIND_ICONS: Record<EffectiveKind, LucideIcon> = {
  regular: Hash,
  color: Palette,
  spacing: Ruler,
  typography: Type,
  themes: SwatchBook,
};

/** Badge tint per kind (collection header), mirroring the cloud. */
export const KIND_BADGE_CLASSES: Record<EffectiveKind, string> = {
  regular: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  spacing: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  typography: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  themes: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
};
