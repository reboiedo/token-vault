/**
 * Reference resolution over a set of collections: token name → raw
 * string value (hex for colors, dimension strings, …), walking
 * aliases, derivations and tailwind refs with cycle protection.
 *
 * Shared by the FileStore's recompute (surfaces materialization) and
 * the editor UI (alias pickers, swatches) so both resolve identically.
 */

import type { CollectionDoc, TokenDoc, TokenValue } from "./types";
import { resolveDerivationToHex } from "./derivation";
import { getTailwindHex } from "./tailwind-colors";
import type { AliasResolvable } from "./surfaces-utils";

export interface Resolver {
  /** Resolve a token ref to its raw value for a mode (undefined = any). */
  resolveRaw(ref: string, mode?: string): string | null;
  /** All tokens as surfaces-utils/picker-ready alias options. */
  aliasOptions(modes: string[]): AliasResolvable[];
  /** Look up a token document by name. */
  get(ref: string): TokenDoc | undefined;
}

export function buildResolver(collections: CollectionDoc[]): Resolver {
  const byName = new Map<string, TokenDoc>();
  for (const c of collections) for (const t of c.tokens) byName.set(t.name, t);

  const resolve = (
    ref: string,
    mode: string | undefined,
    visiting: Set<string>
  ): string | null => {
    if (visiting.has(ref)) return null;
    visiting.add(ref);
    const token = byName.get(ref);
    if (!token) return null;
    const value: TokenValue | undefined =
      (mode ? token.values[mode] : undefined) ??
      token.values["default"] ??
      Object.values(token.values)[0];
    if (!value) return null;
    switch (value.type) {
      case "raw":
        return String(value.value);
      case "alias":
        return resolve(value.token, mode, visiting);
      case "tailwind":
        return getTailwindHex(value.color);
      case "derived":
        try {
          return resolveDerivationToHex(value.base, value.ops, (r) =>
            resolve(r, mode, visiting)
          );
        } catch {
          return null;
        }
      default:
        return null; // expression/composite: not color-resolvable
    }
  };

  return {
    resolveRaw: (ref, mode) => resolve(ref, mode, new Set()),
    get: (ref) => byName.get(ref),
    aliasOptions(modes) {
      return [...byName.keys()].map((name) => {
        const resolvedByMode: Record<string, string> = {};
        for (const mode of modes) {
          const v = resolve(name, mode, new Set());
          if (v) resolvedByMode[mode] = v;
        }
        return {
          name,
          resolvedValue: resolve(name, undefined, new Set()) ?? undefined,
          resolvedByMode,
        };
      });
    },
  };
}
