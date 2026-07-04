/**
 * Reference rewriting — the price of name-based identity.
 *
 * With database ids, renames were free. Here a token's dotted name IS
 * its identity, so renaming must rewrite every reference to it across
 * ALL collections: alias values, derivation pipelines, expression
 * formulas, composite slots, and every ref-bearing corner of a
 * surfaces config. A missed spot silently corrupts the source files —
 * everything funnels through this one module, and `token-vault check`
 * backstops with a dangling-ref scan.
 */

import type {
  CollectionDoc,
  DerivationBase,
  DerivationOp,
  TokenValue,
} from "../core/types";
import { renameIdentifierInFormula } from "../core/expression";
import type {
  SurfaceFgChoice,
  SurfaceLevelAnchor,
  SurfaceLevelRule,
  SurfaceMeasureRef,
  SurfacesConfig,
  SurfaceBaseValue,
} from "../core/surfaces-utils";

export type RenameMap = ReadonlyMap<string, string>;

const ren = (renames: RenameMap, ref: string): string =>
  renames.get(ref) ?? ref;

// ============================================================================
// VALUE REWRITERS
// ============================================================================

function rewriteBase(base: DerivationBase, r: RenameMap): DerivationBase {
  if (base.kind === "token") return { ...base, token: ren(r, base.token) };
  return base;
}

function rewriteOp(op: DerivationOp, r: RenameMap): DerivationOp {
  switch (op.op) {
    case "mix":
      return { ...op, with: ren(r, op.with) };
    case "autoContrast":
      return {
        ...op,
        ...(op.light ? { light: ren(r, op.light) } : {}),
        ...(op.dark ? { dark: ren(r, op.dark) } : {}),
      };
    default:
      return op;
  }
}

export function rewriteValue(value: TokenValue, r: RenameMap): TokenValue {
  switch (value.type) {
    case "raw":
    case "tailwind":
      return value;
    case "alias":
      return { ...value, token: ren(r, value.token) };
    case "derived":
      return {
        ...value,
        base: rewriteBase(value.base, r),
        ops: value.ops.map((op) => rewriteOp(op, r)),
      };
    case "expression": {
      let formula = value.formula;
      for (const [oldName, newName] of r) {
        formula = renameIdentifierInFormula(formula, oldName, newName);
      }
      return formula === value.formula ? value : { ...value, formula };
    }
    case "composite": {
      const rewriteLayer = (layer: Record<string, { type: string } & Record<string, unknown>>) =>
        Object.fromEntries(
          Object.entries(layer).map(([slot, sv]) => [
            slot,
            sv.type === "alias"
              ? { ...sv, token: ren(r, sv.token as string) }
              : sv,
          ])
        );
      return {
        ...value,
        layers: Array.isArray(value.layers)
          ? value.layers.map((l) => rewriteLayer(l as never))
          : rewriteLayer(value.layers as never),
      } as TokenValue;
    }
  }
}

// ============================================================================
// SURFACES CONFIG REWRITERS
// ============================================================================

function rewriteAnchor(a: SurfaceLevelAnchor, r: RenameMap): SurfaceLevelAnchor {
  return a.kind === "alias" ? { ...a, token: ren(r, a.token) } : a;
}

function rewriteMeasureRef(
  m: SurfaceMeasureRef,
  r: RenameMap
): SurfaceMeasureRef {
  return m.kind === "alias" ? { ...m, token: ren(r, m.token) } : m;
}

function rewriteFgChoice(f: SurfaceFgChoice, r: RenameMap): SurfaceFgChoice {
  return f.kind === "alias" ? { ...f, token: ren(r, f.token) } : f;
}

function rewriteSurfaceBase(
  b: SurfaceBaseValue,
  r: RenameMap
): SurfaceBaseValue {
  if (b.kind === "alias") return { ...b, token: ren(r, b.token) };
  if (b.kind === "derived")
    return {
      ...b,
      base: rewriteBase(b.base, r),
      ops: b.ops.map((op) => rewriteOp(op, r)),
    };
  return b;
}

function rewriteRule(rule: SurfaceLevelRule, r: RenameMap): SurfaceLevelRule {
  switch (rule.kind) {
    case "fg": {
      const rewriteBranch = (br: typeof rule.onLight) => {
        if (!("target" in br)) {
          return { ...br, anchor: rewriteAnchor(br.anchor, r) };
        }
        return {
          ...br,
          anchor: rewriteAnchor(br.anchor, r),
          ...(br.measureAgainst
            ? { measureAgainst: rewriteMeasureRef(br.measureAgainst, r) }
            : {}),
        };
      };
      return {
        ...rule,
        onLight: rewriteBranch(rule.onLight),
        onDark: rewriteBranch(rule.onDark),
      };
    }
    case "surface-shift": {
      const rewriteBranch = (br: typeof rule.onLight) =>
        br.mixWith && "token" in br.mixWith
          ? { ...br, mixWith: { ...br.mixWith, token: ren(r, br.mixWith.token) } }
          : br;
      return {
        ...rule,
        onLight: rewriteBranch(rule.onLight),
        onDark: rewriteBranch(rule.onDark),
      };
    }
    case "surface-mix":
      return {
        ...rule,
        onLight: { ...rule.onLight, anchor: rewriteAnchor(rule.onLight.anchor, r) },
        onDark: { ...rule.onDark, anchor: rewriteAnchor(rule.onDark.anchor, r) },
      };
    case "opacity":
      return {
        ...rule,
        source:
          typeof rule.source === "object" && rule.source.kind === "alias"
            ? { ...rule.source, token: ren(r, rule.source.token) }
            : rule.source,
      };
    case "scale-step": {
      const rewriteBranch = (br: typeof rule.onLight) =>
        br.scale?.kind === "alias"
          ? { ...br, scale: { ...br.scale, token: ren(r, br.scale.token) } }
          : br;
      return {
        ...rule,
        onLight: rewriteBranch(rule.onLight),
        onDark: rewriteBranch(rule.onDark),
      };
    }
  }
}

export function rewriteSurfacesConfig(
  config: SurfacesConfig,
  r: RenameMap
): SurfacesConfig {
  return {
    ...config,
    surfaces: config.surfaces.map((s) => ({
      ...s,
      baseByMode: Object.fromEntries(
        Object.entries(s.baseByMode).map(([mode, b]) => [
          mode,
          rewriteSurfaceBase(b, r),
        ])
      ),
      ...(s.fgByMode
        ? {
            fgByMode: Object.fromEntries(
              Object.entries(s.fgByMode).map(([mode, f]) => [
                mode,
                rewriteFgChoice(f, r),
              ])
            ),
          }
        : {}),
    })),
    levels: config.levels.map((l) => ({ ...l, rule: rewriteRule(l.rule, r) })),
  };
}

// ============================================================================
// REF COLLECTION — the read-side twin of the rewriters, used by
// `token-vault check` to find dangling references.
// ============================================================================

export function collectValueRefs(value: TokenValue): string[] {
  switch (value.type) {
    case "raw":
    case "tailwind":
      return [];
    case "alias":
      return [value.token];
    case "derived": {
      const refs: string[] = [];
      if (value.base.kind === "token") refs.push(value.base.token);
      for (const op of value.ops) {
        if (op.op === "mix") refs.push(op.with);
        if (op.op === "autoContrast") {
          if (op.light) refs.push(op.light);
          if (op.dark) refs.push(op.dark);
        }
      }
      return refs;
    }
    case "expression":
      try {
        // Lazy import avoided: parseExpression is pure and cheap.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return parseExpressionIdentifiers(value.formula);
      } catch {
        return [];
      }
    case "composite": {
      const layers = Array.isArray(value.layers)
        ? value.layers
        : [value.layers];
      return layers.flatMap((l) =>
        Object.values(l)
          .filter((s) => s.type === "alias")
          .map((s) => (s as { token: string }).token)
      );
    }
  }
}

import { parseExpression } from "../core/expression";
function parseExpressionIdentifiers(formula: string): string[] {
  return parseExpression(formula).identifiers;
}

export function collectSurfacesRefs(config: SurfacesConfig): string[] {
  const refs: string[] = [];
  const anchor = (a: SurfaceLevelAnchor) => {
    if (a.kind === "alias") refs.push(a.token);
  };
  for (const s of config.surfaces) {
    for (const b of Object.values(s.baseByMode)) {
      if (b.kind === "alias") refs.push(b.token);
      if (b.kind === "derived") {
        if (b.base.kind === "token") refs.push(b.base.token);
        for (const op of b.ops) {
          if (op.op === "mix") refs.push(op.with);
        }
      }
    }
    for (const f of Object.values(s.fgByMode ?? {})) {
      if (f.kind === "alias") refs.push(f.token);
    }
  }
  for (const l of config.levels) {
    const rule = l.rule;
    if (rule.kind === "fg") {
      for (const br of [rule.onLight, rule.onDark]) {
        anchor(br.anchor);
        if ("target" in br && br.measureAgainst?.kind === "alias") {
          refs.push(br.measureAgainst.token);
        }
      }
    } else if (rule.kind === "surface-shift") {
      for (const br of [rule.onLight, rule.onDark]) {
        if (br.mixWith && "token" in br.mixWith) refs.push(br.mixWith.token);
      }
    } else if (rule.kind === "surface-mix") {
      anchor(rule.onLight.anchor);
      anchor(rule.onDark.anchor);
    } else if (rule.kind === "opacity") {
      if (typeof rule.source === "object" && rule.source.kind === "alias") {
        refs.push(rule.source.token);
      }
    } else if (rule.kind === "scale-step") {
      for (const br of [rule.onLight, rule.onDark]) {
        if (br.scale?.kind === "alias") refs.push(br.scale.token);
      }
    }
  }
  return refs;
}

// ============================================================================
// WHOLE-SYSTEM REWRITE
// ============================================================================

/**
 * Rewrite every reference in every SOURCE collection. Returns the new
 * collections plus the names of collections that actually changed (so
 * the store persists only touched files).
 */
export function rewriteRefs(
  collections: CollectionDoc[],
  renames: RenameMap
): { collections: CollectionDoc[]; touched: Set<string> } {
  const touched = new Set<string>();
  const next = collections.map((c) => {
    let changed = false;

    const tokens = c.tokens.map((t) => {
      const values = Object.fromEntries(
        Object.entries(t.values).map(([mode, v]) => {
          const nv = rewriteValue(v, renames);
          if (nv !== v) changed = true;
          return [mode, nv];
        })
      );
      return changed ? { ...t, values } : t;
    });

    let surfacesConfig = c.surfacesConfig;
    if (surfacesConfig) {
      const rewritten = rewriteSurfacesConfig(
        surfacesConfig as SurfacesConfig,
        renames
      );
      if (JSON.stringify(rewritten) !== JSON.stringify(surfacesConfig)) {
        surfacesConfig = rewritten;
        changed = true;
      }
    }

    if (!changed) return c;
    touched.add(c.name);
    return { ...c, tokens, surfacesConfig };
  });
  return { collections: next, touched };
}
