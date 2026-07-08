// Sync logic for Figma variables

import { Collection, CompositeValue, Token, TokenValue, AliasValue, fetchTokens, syncFigmaIds, FluidSettings } from "./api";
import { mapTypeToFigma, convertValueToFigma, inferTypeFromKind, inferTypeFromValue, parseColorToRGBA } from "./utils";

// =============================================================================
// Typography helpers — convert composite token slot values to Figma Text Style
// formats. Figma's Text Style API has specific quirks the rest of the app
// doesn't share.
// =============================================================================

/** Numeric font weights → Figma Text Style "Style Name" strings. */
const FONT_WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "Extra Light",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semi Bold",
  700: "Bold",
  800: "Extra Bold",
  900: "Black",
};

function fontWeightToStyleName(weight: string | number | boolean): string {
  if (typeof weight === "string") {
    const n = parseInt(weight, 10);
    if (!Number.isNaN(n) && FONT_WEIGHT_NAMES[n]) return FONT_WEIGHT_NAMES[n];
    return weight; // assume already a style name like "Regular"
  }
  if (typeof weight === "number") {
    return FONT_WEIGHT_NAMES[weight] ?? "Regular";
  }
  return "Regular";
}

/** Parse a font-size value (rem / px / clamp / number) to pixels. */
function parseFontSize(value: string | number | boolean): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return 16;
  const str = value.trim();
  // For clamp(min, fluid, max), use the max — desktop-first matches our mode order.
  const clampMatch = str.match(/^clamp\(\s*[^,]+,\s*[^,]+,\s*([^)]+)\s*\)$/);
  if (clampMatch) return parseFontSize(clampMatch[1].trim());
  if (str.endsWith("rem")) return parseFloat(str) * 16;
  if (str.endsWith("px")) return parseFloat(str);
  const n = parseFloat(str);
  return Number.isNaN(n) ? 16 : n;
}

/**
 * Letter spacing → Figma's `{ value, unit }` format.
 * em / unitless → percent (lossless: 0.025em == 2.5%).
 * px / rem → pixels.
 */
function parseLetterSpacing(value: string | number | boolean): {
  value: number;
  unit: "PERCENT" | "PIXELS";
} {
  if (typeof value === "number") {
    return { value: value * 100, unit: "PERCENT" };
  }
  if (typeof value !== "string") return { value: 0, unit: "PERCENT" };
  const str = value.trim();
  if (str === "normal" || str === "0") return { value: 0, unit: "PERCENT" };
  if (str.endsWith("em")) return { value: parseFloat(str) * 100, unit: "PERCENT" };
  if (str.endsWith("%")) return { value: parseFloat(str), unit: "PERCENT" };
  if (str.endsWith("rem")) return { value: parseFloat(str) * 16, unit: "PIXELS" };
  if (str.endsWith("px")) return { value: parseFloat(str), unit: "PIXELS" };
  const n = parseFloat(str);
  return Number.isNaN(n) ? { value: 0, unit: "PERCENT" } : { value: n * 100, unit: "PERCENT" };
}

/**
 * Line height → Figma's `{ value, unit } | { unit: "AUTO" }`.
 * Unitless → percent (1.5 == 150%).
 */
type FigmaLineHeight =
  | { value: number; unit: "PIXELS" | "PERCENT" }
  | { unit: "AUTO" };

function parseLineHeight(value: string | number | boolean): FigmaLineHeight {
  if (typeof value === "number") return { value: value * 100, unit: "PERCENT" };
  if (typeof value !== "string") return { unit: "AUTO" };
  const str = value.trim();
  if (str === "normal" || str === "auto") return { unit: "AUTO" };
  if (str.endsWith("em")) return { value: parseFloat(str) * 100, unit: "PERCENT" };
  if (str.endsWith("%")) return { value: parseFloat(str), unit: "PERCENT" };
  if (str.endsWith("rem")) return { value: parseFloat(str) * 16, unit: "PIXELS" };
  if (str.endsWith("px")) return { value: parseFloat(str), unit: "PIXELS" };
  const n = parseFloat(str);
  if (Number.isNaN(n)) return { unit: "AUTO" };
  return { value: n * 100, unit: "PERCENT" };
}

function isCompositeToken(token: Token): boolean {
  for (const v of Object.values(token.values)) {
    if (v && (v as { type?: string }).type === "composite") return true;
  }
  return false;
}

/**
 * Build fluid mode names ordered from largest viewport down to smallest.
 * Figma uses the FIRST mode as the default fallback when no mode is set on a
 * node, so desktop-first means desktop is the default — better matches typical
 * design workflows.
 *
 * e.g., ["@1240px", "@768px", "@360px"]
 */
function getFluidModesFromSettings(settings: FluidSettings): string[] {
  return buildFluidModeNames(settings.viewport, settings.breakpoints ?? []);
}

function buildFluidModeNames(
  viewport: { minWidth: number; maxWidth: number },
  breakpoints: number[]
): string[] {
  const widths = buildFluidBreakpointWidths(viewport, breakpoints);
  return widths.map((w) => `@${w}px`);
}

/**
 * Get breakpoint widths (desktop-first: largest → smallest).
 */
function getFluidBreakpointWidthsFromSettings(settings: FluidSettings): number[] {
  return buildFluidBreakpointWidths(settings.viewport, settings.breakpoints ?? []);
}

function buildFluidBreakpointWidths(
  viewport: { minWidth: number; maxWidth: number },
  breakpoints: number[]
): number[] {
  const widths: number[] = [];

  // Largest first (desktop default)
  widths.push(viewport.maxWidth);

  // Then breakpoints in descending order
  const sortedDesc = [...breakpoints].sort((a, b) => b - a);
  for (const bp of sortedDesc) {
    if (bp > viewport.minWidth && bp < viewport.maxWidth) {
      widths.push(bp);
    }
  }

  // Smallest last (mobile)
  widths.push(viewport.minWidth);

  return widths;
}

/**
 * Calculate interpolated fluid value at a specific viewport width
 */
function calculateFluidValueAtViewport(
  minPx: number,
  maxPx: number,
  viewport: { minWidth: number; maxWidth: number },
  targetWidth: number
): number {
  if (targetWidth <= viewport.minWidth) return minPx;
  if (targetWidth >= viewport.maxWidth) return maxPx;

  const progress = (targetWidth - viewport.minWidth) / (viewport.maxWidth - viewport.minWidth);
  return Math.round((minPx + (maxPx - minPx) * progress) * 100) / 100;
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
 * Convert Figma's resolved type back to our DTCG type system
 * Note: Figma only has COLOR, FLOAT, STRING, BOOLEAN so we can't fully reverse
 */
function figmaTypeToOurType(resolvedType: VariableResolvedDataType): TokenType {
  switch (resolvedType) {
    case "COLOR":
      return "color";
    case "FLOAT":
      return "number"; // Could also be dimension, duration, fontWeight
    case "STRING":
      return "string"; // Could also be fontFamily, cubicBezier, etc.
    case "BOOLEAN":
      return "boolean";
    default:
      return "string";
  }
}

/**
 * Determine the effective DTCG type for a token
 * Priority: collection.type > infer from kind > infer from first value
 */
function getEffectiveType(
  collection: Collection,
  token: Token
): TokenType {
  // 1. Explicit token type wins.
  if (token.type) {
    return token.type as TokenType;
  }

  // 2. Explicit collection type.
  if (collection.type) {
    return collection.type as TokenType;
  }

  // 3. Collection kind, but ONLY for kinds that constrain types. "regular"
  //    collections hold mixed types (e.g. core with colors + fontWeights +
  //    radii), so we fall through to per-value inference instead of forcing
  //    everything to "string". Otherwise hex colors get created as STRING
  //    variables in Figma.
  if (collection.kind && collection.kind !== "regular") {
    return inferTypeFromKind(collection.kind);
  }

  // 4. Infer from first raw value in token.
  const firstValue = Object.values(token.values).find((v) => v.type === "raw") as TokenValue | undefined;
  if (firstValue) {
    return inferTypeFromValue(firstValue.value);
  }

  // 5. Default — only reached if there are no raw values (e.g. alias-only)
  //    AND we couldn't get info from kind. resolveTokenTypeThroughAliases
  //    handles the alias case before getting here.
  return "string";
}

export interface SyncLog {
  type: "info" | "success" | "warning" | "error";
  message: string;
}

export interface SyncResult {
  success: boolean;
  logs: SyncLog[];
  createdCollections: number;
  updatedCollections: number;
  createdTokens: number;
  updatedTokens: number;
  // Name of the design system the sync ran against (so the UI can title
  // itself with it). Undefined if the fetch failed before we knew the name.
  designSystemName?: string;
  // Variables that live in synced collections but didn't get touched by
  // this sync — likely orphans from renamed/deleted DSB tokens or
  // manually-authored variables the user no longer wants. Only populated
  // when `syncToFigma` is called with `detectStale: true`.
  staleVariables?: StaleVariable[];
}

/**
 * A Figma object that's a stale-deletion candidate. Identified post-sync
 * as a variable / text style that wasn't created or updated by this run
 * but sits in a synced surface (collection for variables; document-global
 * for text styles where the name matches a current DSB token).
 *
 * `kind` discriminates between variables and text styles so the UI can
 * route deletion to the right Figma API.
 */
export interface StaleVariable {
  id: string;
  name: string;
  /** Collection name for variables. "Text Styles" for typography duplicates. */
  collectionName: string;
  /** Either a Figma variable's resolved type, or "TEXT_STYLE" for styles. */
  resolvedType: VariableResolvedDataType | "TEXT_STYLE";
  /** Discriminator. Defaults to "variable" when omitted (back-compat). */
  kind?: "variable" | "textStyle";
}

export async function syncToFigma(
  apiKey: string,
  options: { detectStale?: boolean } = {}
): Promise<SyncResult> {
  const logs: SyncLog[] = [];
  const idsToReport: {
    collections: Array<{
      convexId: string;
      figmaId?: string;
      figmaFluidId?: string;
    }>;
    tokens: Array<{
      convexId: string;
      figmaId?: string;
      figmaTextStyleId?: string;
    }>;
    figmaOnlyTokens: Array<{
      name: string;
      figmaId: string;
    }>;
  } = {
    collections: [],
    tokens: [],
    figmaOnlyTokens: [],
  };

  let createdCollections = 0;
  let updatedCollections = 0;
  let createdTokens = 0;
  // Track tokens that actually changed (name, value, or alias) so the
  // summary only reports meaningful updates instead of the count of
  // existing-and-found variables. Idempotent re-syncs should report 0.
  const updatedTokenIds = new Set<string>();

  /**
   * Cheap structural equality for VariableValue. Handles primitives, RGBA
   * objects, and VARIABLE_ALIAS objects. JSON.stringify is used for the
   * object case — small payloads, called once per token-mode.
   */
  function variableValuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === undefined || b === undefined) return false;
    if (typeof a !== typeof b) return false;
    if (typeof a === "object" || typeof b === "object") {
      return JSON.stringify(a) === JSON.stringify(b);
    }
    return false;
  }
  // Name is captured here (vs. inside the try) so the catch branch can also
  // include it in the SyncResult.
  let designSystemName: string | undefined;

  try {
    // 1. Fetch data from API
    logs.push({ type: "info", message: "Fetching tokens from server..." });
    const { designSystem, collections, tokens } = await fetchTokens(apiKey);
    designSystemName = designSystem.name;
    logs.push({ type: "success", message: `Connected to "${designSystem.name}"` });

    // Diagnostic for the figma-only token feature: surface counts at fetch
    // time so we can tell whether the API even returned them.
    const figmaOnlyCount = designSystem.figmaOnlyTokens?.length ?? 0;
    logs.push({
      type: "info",
      message: `Fetched ${figmaOnlyCount} figma-only token(s) from server`,
    });
    if (figmaOnlyCount > 0) {
      for (const t of designSystem.figmaOnlyTokens ?? []) {
        logs.push({
          type: "info",
          message: `  • ${t.name} → collectionId=${t.collectionId}, modes=[${Object.keys(
            t.valuesByBreakpoint
          ).join(",")}]`,
        });
      }
    }

    // 2. Build lookup maps
    const collectionMap = new Map<string, Collection>();
    const tokenMap = new Map<string, Token>();
    const tokensByCollection = new Map<string, Token[]>();

    for (const collection of collections) {
      collectionMap.set(collection._id, collection);
      tokensByCollection.set(collection._id, []);
    }

    for (const token of tokens) {
      tokenMap.set(token._id, token);
      tokensByCollection.get(token.collectionId)?.push(token);
    }

    // 3. Check for bundles and determine sync strategy
    const bundles = designSystem.figmaBundles || [];
    const bundledCollectionIds = new Set<string>();
    for (const bundle of bundles) {
      for (const id of bundle.collectionIds) {
        bundledCollectionIds.add(id);
      }
    }

    // Separate bundled and unbundled collections
    const unbundledCollections = collections.filter(c => !bundledCollectionIds.has(c._id));

    logs.push({ type: "info", message: `Syncing ${bundles.length} bundles, ${unbundledCollections.length} unbundled collections...` });

    // Maps for Figma objects
    const figmaCollectionMap = new Map<string, VariableCollection>();
    const figmaVariableMap = new Map<string, Variable>();

    // Track which Figma collection each source collection maps to
    const collectionToFigmaCollection = new Map<string, VariableCollection>();

    // Every Figma variable id this sync touched — created, recovered, or
    // recognized as the current target for a DSB token / figma-only
    // token. Populated independently of `idsToReport.*` (which is the
    // *server-reporting* concern and only fires on new links). The
    // stale-detection scan reads this set to decide which existing
    // variables count as orphans.
    const touchedVariableIds = new Set<string>();
    // Same idea for Figma Text Styles (typography composites). Used to
    // catch duplicate-name styles produced by previous broken syncs
    // when the figmaTextStyleId link was lost.
    const touchedTextStyleIds = new Set<string>();

    // Every Figma collection this run wrote into (bundles, static
    // partitions, fluid partitions). Used after sync to scope the stale-
    // variable scan — we don't want to flag variables in collections we
    // never touched.
    const syncedFigmaCollectionIds = new Set<string>();

    // 4a. Sync bundles - each bundle becomes one Figma VariableCollection
    for (const bundle of bundles) {
      const bundleCollections = bundle.collectionIds
        .map(id => collectionMap.get(id))
        .filter((c): c is Collection => c !== undefined);

      if (bundleCollections.length === 0) continue;

      // Determine if bundle contains fluid collections (spacing/typography)
      const hasFluidCollections = bundleCollections.some(c =>
        c.kind === "spacing" || c.kind === "typography" || c.kind === "fluid"
      );

      // Get modes - for fluid bundles use global fluid settings, otherwise merge modes
      let bundleModes: string[];
      if (hasFluidCollections && designSystem.fluidSettings) {
        bundleModes = getFluidModesFromSettings(designSystem.fluidSettings);
      } else {
        // Merge modes from all collections in bundle (use first collection's modes as base)
        const modeSet = new Set<string>();
        for (const c of bundleCollections) {
          for (const mode of c.modes) {
            modeSet.add(mode);
          }
        }
        bundleModes = Array.from(modeSet);
        if (bundleModes.length === 0) bundleModes = ["default"];
      }

      // Try to find or create the bundle's Figma collection
      // We use the first collection's figmaCollectionId as the bundle's ID
      let figmaCollection: VariableCollection | null = null;
      const firstCollection = bundleCollections[0];

      if (firstCollection.figmaCollectionId) {
        try {
          figmaCollection = figma.variables.getVariableCollectionById(firstCollection.figmaCollectionId);
        } catch {
          // Collection not found
        }
      }

      // Membership check — verify the looked-up collection is actually live
      // in the document (Figma's getById can return a ghost reference for
      // collections the user deleted in the UI).
      if (figmaCollection) {
        const liveIds = figma.variables.getLocalVariableCollections().map((c) => c.id);
        if (!liveIds.includes(figmaCollection.id)) {
          figmaCollection = null;
        }
      }

      if (!figmaCollection) {
        try {
          figmaCollection = figma.variables.createVariableCollection(bundle.name);
          // Report the bundle's Figma ID for the first collection
          idsToReport.collections.push({
            convexId: firstCollection._id,
            figmaId: figmaCollection.id,
          });
          createdCollections++;
          logs.push({ type: "success", message: `Created bundle "${bundle.name}"` });
        } catch (createError) {
          const errorMsg = createError instanceof Error ? createError.message : "Unknown error";
          throw new Error(`Failed to create bundle "${bundle.name}": ${errorMsg}`);
        }
      } else {
        if (figmaCollection.name !== bundle.name) {
          figmaCollection.name = bundle.name;
        }
        updatedCollections++;
      }

      // Sync modes
      syncModes(figmaCollection, bundleModes);

      syncedFigmaCollectionIds.add(figmaCollection.id);

      // Map all collections in this bundle to the same Figma collection
      for (const c of bundleCollections) {
        collectionToFigmaCollection.set(c._id, figmaCollection);
        figmaCollectionMap.set(c._id, figmaCollection);
      }

      // Sync tokens for bundled collections (with collection name prefix)
      for (const collection of bundleCollections) {
        const collectionTokens = tokensByCollection.get(collection._id) || [];

        for (const token of collectionTokens) {
          // Prefix token name with collection name for bundled tokens
          const prefixedName = `${collection.name}/${token.name}`;

          let figmaVariable: Variable | null = null;

          // Try to find existing variable by Figma ID
          if (token.figmaVariableId) {
            try {
              figmaVariable = figma.variables.getVariableById(token.figmaVariableId);
            } catch {
              // Variable not found
            }
          }

          // Tombstone / wrong-collection check.
          if (
            figmaVariable &&
            ((figmaVariable as { removed?: boolean }).removed ||
              figmaVariable.variableCollectionId !== figmaCollection.id)
          ) {
            figmaVariable = null;
          }

          // Check if it's a fluid token (spacing/typography with minPx/maxPx)
          const isFluidToken = (collection.kind === "spacing" || collection.kind === "typography" || collection.kind === "fluid")
            && token.minPx !== undefined
            && token.maxPx !== undefined
            && designSystem.fluidSettings;

          if (isFluidToken && designSystem.fluidSettings) {
            // Fluid token: create as FLOAT, set values for each breakpoint
            if (!figmaVariable) {
              try {
                figmaVariable = figma.variables.createVariable(
                  prefixedName,
                  figmaCollection,
                  "FLOAT"
                );
                idsToReport.tokens.push({
                  convexId: token._id,
                  figmaId: figmaVariable.id,
                });
                createdTokens++;
              } catch (createError) {
                const errorMsg = createError instanceof Error ? createError.message : "Unknown error";
                throw new Error(`Failed to create fluid variable "${prefixedName}" in bundle "${bundle.name}": ${errorMsg}`);
              }
            } else {
              if (figmaVariable.name !== prefixedName) {
                const prev = figmaVariable.name;
                figmaVariable.name = prefixedName;
                logs.push({
                  type: "info",
                  message: `Renamed fluid variable "${prev}" → "${prefixedName}"`,
                });
                updatedTokenIds.add(token._id);
              }
            }

            figmaVariableMap.set(token._id, figmaVariable);
            touchedVariableIds.add(figmaVariable.id);

            // Set values for each breakpoint mode using global fluid settings
            const breakpointWidths = getFluidBreakpointWidthsFromSettings(designSystem.fluidSettings);
            const viewport = designSystem.fluidSettings.viewport;

            for (const width of breakpointWidths) {
              const modeName = `@${width}px`;
              const modeId = getModeId(figmaCollection, modeName);
              if (!modeId) continue;

              try {
                const value = calculateFluidValueAtViewport(token.minPx!, token.maxPx!, viewport, width);
                if (variableValuesEqual(figmaVariable.valuesByMode[modeId], value)) continue;
                figmaVariable.setValueForMode(modeId, value);
                updatedTokenIds.add(token._id);
              } catch (valueError) {
                const errorMsg = valueError instanceof Error ? valueError.message : "Unknown error";
                throw new Error(`Failed to set fluid value for "${prefixedName}" at ${modeName}: ${errorMsg}`);
              }
            }
          } else {
            // Regular token — resolve type through alias chains so semantic
            // alias-only tokens inherit the leaf's type instead of falling
            // back to STRING.
            const effectiveType = resolveTokenTypeThroughAliases(token, collection);
            let variableType: TokenType;

            if (!figmaVariable) {
              const orphan = findVariableInCollectionByName(figmaCollection, prefixedName);
              if (orphan) {
                figmaVariable = orphan;
                variableType = figmaTypeToOurType(figmaVariable.resolvedType);
                idsToReport.tokens.push({
                  convexId: token._id,
                  figmaId: figmaVariable.id,
                });
                updatedTokenIds.add(token._id);
              } else {
                try {
                  figmaVariable = figma.variables.createVariable(
                    prefixedName,
                    figmaCollection,
                    mapTypeToFigma(effectiveType)
                  );
                  variableType = effectiveType;
                  idsToReport.tokens.push({
                    convexId: token._id,
                    figmaId: figmaVariable.id,
                  });
                  createdTokens++;
                } catch (createError) {
                  const errorMsg = createError instanceof Error ? createError.message : "Unknown error";
                  throw new Error(`Failed to create variable "${prefixedName}" in bundle "${bundle.name}": ${errorMsg}`);
                }
              }
            } else {
              variableType = figmaTypeToOurType(figmaVariable.resolvedType);
              if (figmaVariable.name !== prefixedName) {
                const prev = figmaVariable.name;
                figmaVariable.name = prefixedName;
                logs.push({
                  type: "info",
                  message: `Renamed variable "${prev}" → "${prefixedName}"`,
                });
                updatedTokenIds.add(token._id);
              }
            }

            figmaVariableMap.set(token._id, figmaVariable);
            touchedVariableIds.add(figmaVariable.id);

            // Set raw values for every mode on the Figma collection (with
            // base-mode fallback for modes not explicitly authored).
            const baseMode = collection.modes[0];
            const fallbackValue =
              token.values[baseMode] ?? Object.values(token.values)[0];
            for (const figmaMode of figmaCollection.modes) {
              const value = token.values[figmaMode.name] ?? fallbackValue;
              if (!value || value.type !== "raw") continue;
              const modeId = figmaMode.modeId;
              try {
                const figmaValue = convertValueToFigma(value.value, variableType);
                if (variableValuesEqual(figmaVariable.valuesByMode[modeId], figmaValue)) continue;
                figmaVariable.setValueForMode(modeId, figmaValue);
                updatedTokenIds.add(token._id);
              } catch (valueError) {
                const errorMsg = valueError instanceof Error ? valueError.message : "Unknown error";
                // Don't abort the whole sync over one unconvertible value —
                // skip this mode and warn so every other token still lands.
                logs.push({
                  type: "warning",
                  message: `Skipped "${prefixedName}" (mode: ${figmaMode.name}): ${errorMsg}`,
                });
              }
            }
          }
        }
      }
    }

    // 4b. Sync unbundled collections.
    //
    // Each DSB collection's tokens get partitioned into TWO groups based on
    // whether the token has fluid metadata (`minPx` + `maxPx`). When both
    // groups are non-empty, the DSB collection emits TWO Figma collections:
    //   "<Name>"          → static partition, single mode (or collection.modes)
    //   "<Name> · Fluid"  → fluid partition, breakpoint modes from fluidSettings
    //
    // When only one partition is non-empty, only one Figma collection is
    // emitted (named just <Name>).
    //
    // Each token's existing `figmaVariableId` is honored — if a token already
    // has a Figma variable, we update it in place rather than recreate. Figma
    // variables can't be moved between collections, so an existing token whose
    // partition has changed since last sync will keep updating in its current
    // location. To migrate, the user clears the figmaVariableId or deletes the
    // variable in Figma, after which the next sync recreates it in the right
    // partition.
    for (const collection of unbundledCollections) {
      // Composite-typed tokens (typography) don't map to Figma Variables —
      // they map to Text Styles, which is handled in a separate pass below.
      // Filter them out here so the variable sync doesn't try to write a
      // composite object as a flat variable value.
      const collectionTokens = (tokensByCollection.get(collection._id) || []).filter(
        (t) => !isCompositeToken(t)
      );
      const fluidTokens = collectionTokens.filter(
        (t) => t.minPx !== undefined && t.maxPx !== undefined
      );
      const staticTokens = collectionTokens.filter(
        (t) => t.minPx === undefined || t.maxPx === undefined
      );

      // Resolve viewport/breakpoints once per collection — prefer the
      // collection's own legacy spacingScaleConfig if present, otherwise the
      // design-system-wide fluidSettings.
      const fluidViewport =
        collection.spacingScaleConfig?.viewport ??
        designSystem.fluidSettings?.viewport;
      const fluidBreakpoints =
        collection.spacingScaleConfig?.breakpoints ??
        designSystem.fluidSettings?.breakpoints ??
        [];

      // Figma-only tokens scoped to this collection — they live in the fluid
      // partition alongside (or, if no real fluid tokens exist, instead of)
      // interpolated tokens. They have explicit per-breakpoint values.
      const figmaOnlyForCollection = (designSystem.figmaOnlyTokens ?? []).filter(
        (t) => t.collectionId === collection._id
      );

      // The user fluid metadata only makes sense if we know a viewport. If we
      // don't, demote any "fluid" tokens to static so they don't get silently
      // dropped. Figma-only tokens also require a viewport (they target the
      // fluid partition's modes).
      const canEmitFluid =
        fluidViewport !== undefined &&
        (fluidTokens.length > 0 || figmaOnlyForCollection.length > 0);

      // ---- Static partition --------------------------------------------------
      let staticFigmaCollection: VariableCollection | null = null;
      if (staticTokens.length > 0) {
        staticFigmaCollection = ensureFigmaCollection({
          existingId: collection.figmaCollectionId,
          name: collection.name,
          modes: collection.modes,
          onCreate: (figmaId) => {
            idsToReport.collections.push({ convexId: collection._id, figmaId });
            createdCollections++;
            logs.push({ type: "success", message: `Created collection "${collection.name}"` });
          },
          onUpdate: () => {
            updatedCollections++;
          },
        });
        figmaCollectionMap.set(collection._id, staticFigmaCollection);
        collectionToFigmaCollection.set(collection._id, staticFigmaCollection);

        for (const token of staticTokens) {
          syncStaticToken(token, collection, staticFigmaCollection);
        }
      }

      // ---- Fluid partition ---------------------------------------------------
      let fluidFigmaCollection: VariableCollection | null = null;
      if (canEmitFluid && fluidViewport) {
        const fluidModes = buildFluidModeNames(fluidViewport, fluidBreakpoints);
        const fluidName =
          staticTokens.length > 0
            ? `${collection.name} · Fluid`
            : collection.name;
        fluidFigmaCollection = ensureFigmaCollection({
          existingId: collection.figmaFluidCollectionId,
          name: fluidName,
          modes: fluidModes,
          onCreate: (figmaId) => {
            idsToReport.collections.push({
              convexId: collection._id,
              figmaFluidId: figmaId,
            });
            createdCollections++;
            logs.push({ type: "success", message: `Created collection "${fluidName}"` });
          },
          onUpdate: () => {
            updatedCollections++;
          },
        });

        for (const token of fluidTokens) {
          syncFluidToken(token, fluidFigmaCollection, fluidViewport, fluidBreakpoints);
        }

        // ---- Figma-only tokens (explicit per-breakpoint values) ----------
        if (figmaOnlyForCollection.length > 0) {
          logs.push({
            type: "info",
            message: `Syncing ${figmaOnlyForCollection.length} figma-only token(s) into "${fluidName}"`,
          });
        }
        for (const fot of figmaOnlyForCollection) {
          syncFigmaOnlyToken(fot, fluidFigmaCollection);
        }
      } else if (fluidTokens.length > 0) {
        // No viewport — write the fluid tokens into the static collection as
        // raw single-mode values (best-effort fallback).
        for (const token of fluidTokens) {
          if (staticFigmaCollection) {
            syncStaticToken(token, collection, staticFigmaCollection);
          }
        }
      }
    }

    // Helpers used by the loop above. Declared inside the function so they
    // close over idsToReport / counters / logs.
    function ensureFigmaCollection(opts: {
      existingId: string | undefined;
      name: string;
      modes: string[];
      onCreate: (figmaId: string) => void;
      onUpdate: () => void;
    }): VariableCollection {
      let figmaCollection: VariableCollection | null = null;
      if (opts.existingId) {
        try {
          figmaCollection = figma.variables.getVariableCollectionById(opts.existingId);
        } catch {
          // not found, fall through to create
        }
      }
      // Membership check — Figma's `getVariableCollectionById` can return a
      // ghost reference for collections deleted in the UI (the JS object is
      // still alive but the collection isn't in the document anymore). The
      // authoritative list of live collections is `getLocalVariableCollections`,
      // so verify our match is in there. If not, treat as missing and recreate.
      if (figmaCollection) {
        const liveIds = figma.variables.getLocalVariableCollections().map((c) => c.id);
        if (!liveIds.includes(figmaCollection.id)) {
          figmaCollection = null;
        }
      }
      if (!figmaCollection) {
        try {
          figmaCollection = figma.variables.createVariableCollection(opts.name);
          opts.onCreate(figmaCollection.id);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          throw new Error(`Failed to create collection "${opts.name}": ${msg}`);
        }
      } else {
        if (figmaCollection.name !== opts.name) figmaCollection.name = opts.name;
        opts.onUpdate();
      }
      syncModes(figmaCollection, opts.modes.length > 0 ? opts.modes : ["default"]);
      syncedFigmaCollectionIds.add(figmaCollection.id);
      return figmaCollection;
    }

    /**
     * Resolve a token's effective type by walking alias chains until we hit
     * a token with a raw value (or a fluid leaf, which is always FLOAT).
     *
     * Why this exists: a semantic-only token like `layout/gap` whose only
     * value is an alias to `space/s` has no raw value to infer from, and its
     * collection has no `type`/`kind`, so `getEffectiveType` falls through
     * to "string". Creating a STRING variable then fails when we try to
     * point it at a FLOAT alias ("Mismatched variable resolved type").
     *
     * Walks at most a small depth — alias chains in practice are 2-3 hops.
     */
    function resolveTokenTypeThroughAliases(
      startToken: Token,
      startCollection: Collection
    ): TokenType {
      const visited = new Set<string>();
      let current: Token | undefined = startToken;
      let currentCollection: Collection | undefined = startCollection;
      while (current && !visited.has(current._id)) {
        visited.add(current._id);

        // Fluid tokens are always FLOAT regardless of collection type.
        if (current.minPx !== undefined && current.maxPx !== undefined) {
          return "number";
        }

        // If this token has any raw value, defer to the normal type lookup.
        const hasRaw = Object.values(current.values).some((v) => v.type === "raw");
        if (hasRaw) {
          return getEffectiveType(currentCollection!, current);
        }

        // Alias-only — walk one hop. Prefer the default mode if present;
        // otherwise just take the first alias.
        const aliasValue =
          (current.values["default"] && current.values["default"].type === "alias"
            ? current.values["default"]
            : Object.values(current.values).find((v) => v.type === "alias")) as
            | { type: "alias"; tokenId: string }
            | undefined;
        if (!aliasValue) break;

        const next = tokenMap.get(aliasValue.tokenId);
        if (!next) break;
        current = next;
        currentCollection = collectionMap.get(next.collectionId);
        if (!currentCollection) break;
      }
      // Fall back to the static analyzer for the start token.
      return getEffectiveType(startCollection, startToken);
    }

    /**
     * Look up an existing variable in a collection by name. Used to recover
     * from a previous sync that partially created variables before failing —
     * those orphans aren't tracked in `figmaVariableId` on Convex, so naïve
     * `createVariable` would throw "duplicate variable name".
     */
    function findVariableInCollectionByName(
      figmaCollection: VariableCollection,
      name: string
    ): Variable | null {
      for (const id of figmaCollection.variableIds) {
        const v = figma.variables.getVariableById(id);
        if (v && v.name === name) return v;
      }
      return null;
    }

    function syncStaticToken(
      token: Token,
      collection: Collection,
      figmaCollection: VariableCollection
    ): void {
      let figmaVariable: Variable | null = null;
      if (token.figmaVariableId) {
        try {
          figmaVariable = figma.variables.getVariableById(token.figmaVariableId);
        } catch {
          // not found
        }
      }
      // Reasons to treat the stored variable as missing and recreate fresh:
      //  1. Figma returned null (deletion is recognized).
      //  2. The variable's stored collection id doesn't match where we're
      //     writing (cross-collection stray from a previous sync).
      //  3. The variable's id is no longer in the target collection's live
      //     `variableIds` list — Figma sometimes returns a "ghost" reference
      //     for deleted variables that still has a non-null object identity.
      if (
        figmaVariable &&
        (figmaVariable.variableCollectionId !== figmaCollection.id ||
          !figmaCollection.variableIds.includes(figmaVariable.id))
      ) {
        figmaVariable = null;
      }
      // Walk alias chains so a semantic-only token inherits the leaf token's
      // type. Without this, an alias-only token in a regular collection gets
      // typed STRING and the FLOAT alias binding fails.
      const effectiveType = resolveTokenTypeThroughAliases(token, collection);

      // If the existing variable's resolvedType doesn't match what we'd
      // create today, drop it and recreate. Most common cause: an earlier
      // sync mis-typed the token (e.g. hex colors stored as STRING because
      // the regular collection got inferTypeFromKind → "string"). Figma
      // doesn't let you change a variable's resolvedType in place. We
      // compare at the Figma level since several of our types collapse to
      // the same Figma type (number/dimension/fontWeight all → FLOAT).
      if (
        figmaVariable &&
        mapTypeToFigma(effectiveType) !== figmaVariable.resolvedType
      ) {
        const prevType = figmaVariable.resolvedType;
        try {
          figmaVariable.remove();
        } catch {
          // best effort
        }
        figmaVariable = null;
        logs.push({
          type: "info",
          message: `Recreating "${token.name}" — type changed from ${prevType} to ${mapTypeToFigma(effectiveType)}`,
        });
      }

      // Initialize so TS sees this as definitely assigned along every branch
      // below; the orphan-mismatch branch may not assign it directly but
      // either reuses or recreates the variable, which always sets it.
      let variableType: TokenType = effectiveType;
      if (!figmaVariable) {
        // Recover from orphaned variables created by a previous failed sync —
        // they exist by name but aren't linked to the Convex token, so a
        // plain createVariable would hit "duplicate variable name".
        const orphan = findVariableInCollectionByName(figmaCollection, token.name);
        if (orphan) {
          // If the orphan's type doesn't match what we need (common when a
          // prior sync mis-typed an alias-only token as STRING), drop it and
          // recreate. Safe because the orphan has no Convex link by definition.
          if (figmaTypeToOurType(orphan.resolvedType) !== effectiveType) {
            try {
              orphan.remove();
            } catch {
              // best effort; if removal fails we'll fall through to the
              // create call below and surface that error instead.
            }
          } else {
            figmaVariable = orphan;
            idsToReport.tokens.push({ convexId: token._id, figmaId: figmaVariable.id });
            variableType = figmaTypeToOurType(figmaVariable.resolvedType);
            // Linking an orphan back to Convex IS a meaningful change.
            updatedTokenIds.add(token._id);
          }
        }
        if (!figmaVariable) {
          try {
            figmaVariable = figma.variables.createVariable(
              token.name,
              figmaCollection,
              mapTypeToFigma(effectiveType)
            );
            variableType = effectiveType;
            idsToReport.tokens.push({ convexId: token._id, figmaId: figmaVariable.id });
            createdTokens++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            throw new Error(
              `Failed to create variable "${token.name}" in collection "${collection.name}": ${msg}`
            );
          }
        }
      } else {
        variableType = figmaTypeToOurType(figmaVariable.resolvedType);
        if (figmaVariable.name !== token.name) {
          const prev = figmaVariable.name;
          figmaVariable.name = token.name;
          logs.push({
            type: "info",
            message: `Renamed variable "${prev}" → "${token.name}"`,
          });
          updatedTokenIds.add(token._id);
        }
      }
      figmaVariableMap.set(token._id, figmaVariable);
      touchedVariableIds.add(figmaVariable.id);

      // Apply raw values for every mode on the Figma collection (not just
      // the modes present in token.values). Missing modes inherit the base
      // mode's value — same fallback semantics DTCG export uses. Without
      // this, removing a per-mode override in the web app leaves a stale
      // value behind in Figma.
      const baseMode = collection.modes[0];
      const fallbackValue =
        token.values[baseMode] ?? Object.values(token.values)[0];
      for (const figmaMode of figmaCollection.modes) {
        const value = token.values[figmaMode.name] ?? fallbackValue;
        if (!value || value.type !== "raw") continue;
        const modeId = figmaMode.modeId;
        try {
          const figmaValue = convertValueToFigma(value.value, variableType);
          if (variableValuesEqual(figmaVariable.valuesByMode[modeId], figmaValue)) continue;
          figmaVariable.setValueForMode(modeId, figmaValue);
          updatedTokenIds.add(token._id);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          // A single unconvertible value (e.g. a color format we can't parse)
          // shouldn't abort the whole sync — skip this mode and keep going so
          // every other token still lands. Surface it as a warning instead.
          logs.push({
            type: "warning",
            message: `Skipped "${token.name}" (mode: ${figmaMode.name}, type: ${variableType}): ${msg}`,
          });
        }
      }
    }

    function syncFluidToken(
      token: Token,
      figmaCollection: VariableCollection,
      viewport: { minWidth: number; maxWidth: number },
      breakpoints: number[]
    ): void {
      let figmaVariable: Variable | null = null;
      if (token.figmaVariableId) {
        try {
          figmaVariable = figma.variables.getVariableById(token.figmaVariableId);
        } catch {
          // not found
        }
      }
      // Same membership-list guard as syncStaticToken: a Figma variable is
      // only "live" in a collection if its id is in `collection.variableIds`.
      if (
        figmaVariable &&
        (figmaVariable.variableCollectionId !== figmaCollection.id ||
          !figmaCollection.variableIds.includes(figmaVariable.id))
      ) {
        figmaVariable = null;
      }
      if (!figmaVariable) {
        // Recover an orphaned variable left over from a previous failed sync.
        const orphan = findVariableInCollectionByName(figmaCollection, token.name);
        if (orphan) {
          figmaVariable = orphan;
          idsToReport.tokens.push({ convexId: token._id, figmaId: figmaVariable.id });
          updatedTokenIds.add(token._id);
        } else {
          try {
            figmaVariable = figma.variables.createVariable(token.name, figmaCollection, "FLOAT");
            idsToReport.tokens.push({ convexId: token._id, figmaId: figmaVariable.id });
            createdTokens++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            throw new Error(`Failed to create fluid variable "${token.name}": ${msg}`);
          }
        }
      } else {
        if (figmaVariable.name !== token.name) {
          const prev = figmaVariable.name;
          figmaVariable.name = token.name;
          logs.push({
            type: "info",
            message: `Renamed fluid variable "${prev}" → "${token.name}"`,
          });
          updatedTokenIds.add(token._id);
        }
      }
      figmaVariableMap.set(token._id, figmaVariable);
      touchedVariableIds.add(figmaVariable.id);

      const widths = buildFluidBreakpointWidths(viewport, breakpoints);
      for (const width of widths) {
        const modeName = `@${width}px`;
        const modeId = getModeId(figmaCollection, modeName);
        if (!modeId) continue;
        try {
          const v = calculateFluidValueAtViewport(token.minPx!, token.maxPx!, viewport, width);
          if (variableValuesEqual(figmaVariable.valuesByMode[modeId], v)) continue;
          figmaVariable.setValueForMode(modeId, v);
          updatedTokenIds.add(token._id);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          throw new Error(`Failed to set fluid value for "${token.name}" at ${modeName}: ${msg}`);
        }
      }
    }

    /**
     * Sync a figma-only token into the fluid partition. Same name/orphan/value
     * idempotency rules as syncFluidToken, but the values come straight from
     * the user-defined `valuesByBreakpoint` instead of being interpolated.
     * Tracked via name in idsToReport.figmaOnlyTokens (no Convex token row
     * exists for these).
     */
    function syncFigmaOnlyToken(
      tok: { name: string; valuesByBreakpoint: Record<string, number>; figmaVariableId?: string },
      figmaCollection: VariableCollection
    ): void {
      let figmaVariable: Variable | null = null;
      if (tok.figmaVariableId) {
        try {
          figmaVariable = figma.variables.getVariableById(tok.figmaVariableId);
        } catch {
          // not found
        }
      }
      if (
        figmaVariable &&
        (figmaVariable.variableCollectionId !== figmaCollection.id ||
          !figmaCollection.variableIds.includes(figmaVariable.id))
      ) {
        figmaVariable = null;
      }
      let didChange = false;
      if (!figmaVariable) {
        const orphan = findVariableInCollectionByName(figmaCollection, tok.name);
        if (orphan && orphan.resolvedType === "FLOAT") {
          figmaVariable = orphan;
          idsToReport.figmaOnlyTokens.push({ name: tok.name, figmaId: figmaVariable.id });
          didChange = true;
        } else {
          if (orphan) {
            try { orphan.remove(); } catch { /* best effort */ }
          }
          try {
            figmaVariable = figma.variables.createVariable(tok.name, figmaCollection, "FLOAT");
            idsToReport.figmaOnlyTokens.push({ name: tok.name, figmaId: figmaVariable.id });
            createdTokens++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            throw new Error(`Failed to create figma-only variable "${tok.name}": ${msg}`);
          }
        }
      } else {
        if (figmaVariable.name !== tok.name) {
          const prev = figmaVariable.name;
          figmaVariable.name = tok.name;
          logs.push({
            type: "info",
            message: `Renamed figma-only variable "${prev}" → "${tok.name}"`,
          });
          didChange = true;
        }
      }

      // Record the touched id regardless of branch (create / orphan-match
      // / existing-by-id). Without this, a value-only update on an existing
      // figma-only variable wouldn't appear in the touched set and the
      // stale-detection scan would flag it for deletion.
      touchedVariableIds.add(figmaVariable.id);

      // Apply the explicit per-breakpoint values to whatever modes the
      // collection currently has. Modes the user removed in fluid settings
      // are silently dropped (their key won't match any modeId).
      for (const [modeKey, value] of Object.entries(tok.valuesByBreakpoint)) {
        const modeId = getModeId(figmaCollection, modeKey);
        if (!modeId) continue;
        if (variableValuesEqual(figmaVariable.valuesByMode[modeId], value)) continue;
        try {
          figmaVariable.setValueForMode(modeId, value);
          didChange = true;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          throw new Error(`Failed to set figma-only value for "${tok.name}" at ${modeKey}: ${msg}`);
        }
      }

      // We don't have a token._id to add to updatedTokenIds; just bump a
      // local counter for the summary if anything changed.
      if (didChange && tok.figmaVariableId) {
        // Reuse updatedTokenIds keyed by name to keep the sync summary honest.
        updatedTokenIds.add(`figmaOnly:${tok.name}`);
      }
    }

    // 5. Second pass: set alias values (now that all variables exist).
    // Same per-Figma-mode iteration as the raw pass — modes missing in
    // token.values fall back to the base mode's value, so a single alias
    // set on light cascades explicitly to dark/purple/etc.
    for (const token of tokens) {
      const collection = collectionMap.get(token.collectionId);
      if (!collection) continue;

      const figmaCollection = collectionToFigmaCollection.get(token.collectionId);
      if (!figmaCollection) continue;

      const figmaVariable = figmaVariableMap.get(token._id);
      if (!figmaVariable) continue;

      const baseMode = collection.modes[0];
      const fallbackValue =
        token.values[baseMode] ?? Object.values(token.values)[0];

      for (const figmaMode of figmaCollection.modes) {
        const value = token.values[figmaMode.name] ?? fallbackValue;
        if (!value || value.type !== "alias") continue;

        const modeId = figmaMode.modeId;

        const targetVariable = figmaVariableMap.get((value as AliasValue).tokenId);
        if (!targetVariable) {
          logs.push({
            type: "error",
            message: `Could not find target variable for alias in "${token.name}"`,
          });
          continue;
        }

        const alias = figma.variables.createVariableAlias(targetVariable);
        if (variableValuesEqual(figmaVariable.valuesByMode[modeId], alias)) continue;
        figmaVariable.setValueForMode(modeId, alias);
        updatedTokenIds.add(token._id);
      }
    }

    // 5b. Sync typography composite tokens as Figma Text Styles.
    //
    // Composite tokens (DTCG `typography`) carry a 5-slot value (fontFamily,
    // fontSize, fontWeight, letterSpacing, lineHeight) that doesn't fit in a
    // single Figma Variable. They map to Figma Text Styles instead.
    //
    // For each composite token:
    //  1. Resolve every slot's value (raw, or alias → leaf raw value).
    //  2. Convert formats Figma needs differently (em → %, number → style name).
    //  3. Create or update a Text Style. Existing-id lookup uses tombstone /
    //     local-list checks (same pattern as the variable sync) so manual
    //     deletions in Figma are detected.
    let createdStyles = 0;
    let updatedStyles = 0;
    let skippedStyles = 0;

    const tokenById = new Map<string, Token>();
    for (const t of tokens) tokenById.set(t._id, t);

    /** Walk an alias chain and return the leaf raw value (or null). */
    function resolveLeafValue(
      sub: TokenValue | AliasValue,
      modeName: string,
      slotKey: string
    ): string | number | boolean | null {
      if (!sub) return null;
      if (sub.type === "raw") return sub.value;
      if (sub.type === "alias") {
        const target = tokenById.get(sub.tokenId);
        if (!target) return null;

        // For fontSize on a fluid token, prefer the desktop value (maxPx)
        // since Text Styles don't have mode resolution.
        if (slotKey === "fontSize" && target.maxPx !== undefined) {
          return target.maxPx;
        }

        const targetValue =
          (target.values as Record<string, TokenValue | AliasValue | CompositeValue | undefined>)[modeName] ??
          (target.values as Record<string, TokenValue | AliasValue | CompositeValue | undefined>)["default"] ??
          (Object.values(target.values)[0] as TokenValue | AliasValue | CompositeValue | undefined);
        if (!targetValue) return null;
        if (targetValue.type === "composite") return null;
        return resolveLeafValue(targetValue as TokenValue | AliasValue, modeName, slotKey);
      }
      return null;
    }

    /**
     * Walk an alias chain and return the LEAF token (the one whose value is
     * raw, not an alias). Used to look up the token's Figma Variable for
     * binding. Returns null for non-aliases or broken chains.
     */
    function findLeafTokenForBinding(
      sub: TokenValue | AliasValue,
      modeName: string
    ): Token | null {
      if (!sub || sub.type !== "alias") return null;
      const visited = new Set<string>();
      let currentId: string | undefined = sub.tokenId;
      while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const target: Token | undefined = tokenById.get(currentId);
        if (!target) return null;
        const next =
          (target.values as Record<string, TokenValue | AliasValue | CompositeValue | undefined>)[modeName] ??
          (target.values as Record<string, TokenValue | AliasValue | CompositeValue | undefined>)["default"] ??
          (Object.values(target.values)[0] as TokenValue | AliasValue | CompositeValue | undefined);
        if (!next) return target;
        if (next.type === "raw") return target; // leaf
        if (next.type === "composite") return null;
        if (next.type === "alias") {
          currentId = next.tokenId;
          continue;
        }
        return target;
      }
      return null;
    }

    /** Look up a Figma Variable for a token, falling back to stored id. */
    function lookupFigmaVariable(token: Token | null): Variable | null {
      if (!token) return null;
      const fromMap = figmaVariableMap.get(token._id);
      if (fromMap) return fromMap;
      if (token.figmaVariableId) {
        try {
          return figma.variables.getVariableById(token.figmaVariableId);
        } catch {
          return null;
        }
      }
      return null;
    }

    // Sort composite tokens by sortOrder (falls back to insertion order when
    // missing). We thread `moveLocalTextStyleAfter` through the loop so
    // each synced style is reordered to follow the previous one, which
    // brings the Figma Text Styles panel into the same order as the
    // web app — including for styles that were created on a prior sync.
    // Route composite tokens by their DTCG type. Only `typography` composites
    // become Text Styles; `shadow` → Effect Styles and `gradient` → Paint
    // Styles are handled in dedicated passes below. Other composite types
    // (border, transition) have no Figma surface yet — skip them with a note
    // instead of misrouting them into the Text Style pass (where they'd fail
    // the fontFamily/fontSize check and log spurious errors).
    const sortByOrder = (list: Token[]) =>
      [...list].sort((a, b) => {
        const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
        const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return a.name.localeCompare(b.name);
      });

    const allComposites = tokens.filter(isCompositeToken);
    const shadowTokens = sortByOrder(allComposites.filter((t) => t.type === "shadow"));
    const gradientTokens = sortByOrder(allComposites.filter((t) => t.type === "gradient"));
    // Typography is the catch-all (preserving prior behavior) MINUS the
    // composite types that have their own pass or aren't exported yet. This
    // way a typography token keeps syncing even if its `type` field is unset
    // or legacy, while shadow/gradient/border/transition never misroute here.
    const NON_TYPOGRAPHY = new Set(["shadow", "gradient", "border", "transition"]);
    const compositeTokens = sortByOrder(
      allComposites.filter((t) => !t.type || !NON_TYPOGRAPHY.has(t.type))
    );

    // Composite types we don't export yet — note them once so the user knows
    // why they're absent from Figma rather than silently dropping them.
    const unsupportedComposite = allComposites.filter(
      (t) => t.type === "border" || t.type === "transition"
    );
    if (unsupportedComposite.length > 0) {
      logs.push({
        type: "info",
        message: `Skipping ${unsupportedComposite.length} composite token(s) of type border/transition — not yet exported to Figma.`,
      });
    }

    if (compositeTokens.length > 0) {
      logs.push({
        type: "info",
        message: `Syncing ${compositeTokens.length} typography style(s)...`,
      });
    }

    // Tracks the last successfully-synced style so the next one knows
    // where to insert itself. `null` = move to the very top of the
    // Text Styles panel.
    let prevTextStyle: TextStyle | null = null;

    for (const token of compositeTokens) {
      // Find the composite value to use. Most typography tokens are single-mode.
      const modeName = Object.keys(token.values)[0];
      const composite = token.values[modeName] as CompositeValue | undefined;
      if (!composite || composite.type !== "composite") continue;

      const slots: Record<string, string | number | boolean | null> = {};
      for (const slotKey of ["fontFamily", "fontSize", "fontWeight", "letterSpacing", "lineHeight"]) {
        const sub = composite.value[slotKey];
        slots[slotKey] = sub ? resolveLeafValue(sub as TokenValue | AliasValue, modeName, slotKey) : null;
      }

      // Need at least family + size to make a usable style.
      if (slots.fontFamily == null || slots.fontSize == null) {
        skippedStyles++;
        logs.push({
          type: "error",
          message: `Skipped typography "${token.name}" — fontFamily or fontSize unresolved.`,
        });
        continue;
      }

      // Find or create the Text Style.
      let textStyle: TextStyle | null = null;
      if (token.figmaTextStyleId) {
        try {
          const existing = figma.getStyleById(token.figmaTextStyleId);
          if (existing && existing.type === "TEXT") textStyle = existing as TextStyle;
        } catch {
          // not found
        }
      }
      // Membership check — same ghost-reference pattern as variables.
      if (textStyle) {
        const liveIds = figma.getLocalTextStyles().map((s) => s.id);
        if (!liveIds.includes(textStyle.id)) textStyle = null;
      }

      // Orphan-by-name recovery. If the stored id is gone (or never set —
      // e.g. the file was duplicated, the user deleted the DSB-created
      // style, or the Convex link was lost), look for a local text style
      // with the same name and adopt it. Without this, every such sync
      // creates a duplicate.
      const styleName = token.name; // names already use "/" from the API mapping
      if (!textStyle) {
        const orphan = figma
          .getLocalTextStyles()
          .find((s) => s.name === styleName);
        if (orphan) {
          textStyle = orphan;
          idsToReport.tokens.push({
            convexId: token._id,
            figmaTextStyleId: textStyle.id,
          });
          logs.push({
            type: "info",
            message: `Linked existing text style "${styleName}" to DSB token`,
          });
        }
      }

      const isNewStyle = !textStyle;
      if (!textStyle) {
        textStyle = figma.createTextStyle();
        idsToReport.tokens.push({
          convexId: token._id,
          figmaTextStyleId: textStyle.id,
        });
        createdStyles++;
      }
      // Track every text style this sync wrote into so the stale-detect
      // scan below knows what's owned by DSB this run.
      touchedTextStyleIds.add(textStyle.id);

      // Track whether anything actually changes — sync runs every poll, but
      // we don't want to count "updated" or noisily log when the style is
      // already in the desired state.
      let didChange = isNewStyle;

      if (textStyle.name !== styleName) {
        textStyle.name = styleName;
        didChange = true;
      }

      // Apply slot values. fontFamily + fontWeight are tied via fontName and
      // require loadFontAsync first. Try the requested weight; if Figma
      // doesn't have that style for the family, fall back to "Regular" with
      // a log warning instead of skipping the whole style.
      const family = String(slots.fontFamily);
      const requestedStyle = fontWeightToStyleName(slots.fontWeight ?? 400);
      let appliedStyle = requestedStyle;

      try {
        await figma.loadFontAsync({ family, style: requestedStyle });
      } catch {
        if (requestedStyle !== "Regular") {
          try {
            await figma.loadFontAsync({ family, style: "Regular" });
            appliedStyle = "Regular";
            logs.push({
              type: "info",
              message: `"${token.name}": "${family} ${requestedStyle}" not available, using "Regular".`,
            });
          } catch (err2) {
            const msg = err2 instanceof Error ? err2.message : "Unknown error";
            skippedStyles++;
            logs.push({
              type: "error",
              message: `Skipped "${token.name}" — font "${family}" not available: ${msg}`,
            });
            continue;
          }
        } else {
          skippedStyles++;
          logs.push({
            type: "error",
            message: `Skipped "${token.name}" — font "${family} Regular" not available.`,
          });
          continue;
        }
      }

      try {
        const desiredFontName = { family, style: appliedStyle };
        if (
          textStyle.fontName.family !== desiredFontName.family ||
          textStyle.fontName.style !== desiredFontName.style
        ) {
          textStyle.fontName = desiredFontName;
          didChange = true;
        }

        // ── fontSize: bind ONLY when the leaf token is fluid (has minPx/maxPx).
        // The fluid sync writes those variables in actual pixels, so binding
        // gives correct sizes that respond to frame mode. Static dimension
        // variables hold raw rem numbers (0.75 for "0.75rem") and would
        // render as 0.75 pixels if bound — so always resolve those.
        const fontSizeSlot = composite.value.fontSize as TokenValue | AliasValue | undefined;
        const fontSizeLeaf = fontSizeSlot
          ? findLeafTokenForBinding(fontSizeSlot, modeName)
          : null;
        const fontSizeIsFluid =
          !!fontSizeLeaf && fontSizeLeaf.minPx !== undefined && fontSizeLeaf.maxPx !== undefined;
        const fontSizeVar = fontSizeIsFluid ? lookupFigmaVariable(fontSizeLeaf) : null;
        if (fontSizeVar && fontSizeVar.resolvedType === "FLOAT") {
          const currentBinding = textStyle.boundVariables?.fontSize;
          if (currentBinding?.id !== fontSizeVar.id) {
            textStyle.setBoundVariable("fontSize", fontSizeVar);
            didChange = true;
          }
        } else {
          const desiredFontSize = parseFontSize(slots.fontSize);
          if (textStyle.fontSize !== desiredFontSize) {
            textStyle.fontSize = desiredFontSize;
            didChange = true;
          }
        }

        // letterSpacing — DON'T bind. Figma's FLOAT variables are unit-less,
        // but letterSpacing requires a unit (PIXELS or PERCENT). The em→%
        // conversion only makes sense at sync time on the resolved value.
        // Binding the variable would make Figma interpret -0.025 as
        // "-0.025 pixels" instead of "-2.5%".
        if (slots.letterSpacing != null) {
          const desired = parseLetterSpacing(slots.letterSpacing);
          // letterSpacing's unit is always PERCENT or PIXELS (no AUTO) so we
          // can compare both unit and value directly.
          if (
            textStyle.letterSpacing.unit !== desired.unit ||
            textStyle.letterSpacing.value !== desired.value
          ) {
            textStyle.letterSpacing = desired;
            didChange = true;
          }
        }

        // lineHeight — same reason. A unitless 1.5 needs to become 150%, but
        // the Figma variable holds the raw number 1.5 (interpreted as pixels
        // when bound). Resolve at sync time only.
        if (slots.lineHeight != null) {
          const desired = parseLineHeight(slots.lineHeight);
          if (
            textStyle.lineHeight.unit !== desired.unit ||
            (desired.unit !== "AUTO" &&
              (textStyle.lineHeight as { value?: number }).value !== (desired as { value?: number }).value)
          ) {
            textStyle.lineHeight = desired;
            didChange = true;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        logs.push({
          type: "error",
          message: `Failed applying style for "${token.name}": ${msg}`,
        });
      }

      if (didChange && !isNewStyle) {
        updatedStyles++;
      }

      // Only emit the per-token diagnostic when something actually changed,
      // to keep the sync log quiet on no-op runs.
      if (didChange) {
        logs.push({
          type: "info",
          message:
            `↳ ${token.name}: ` +
            `family=${slots.fontFamily}, ` +
            `weight=${slots.fontWeight}→${appliedStyle}, ` +
            `size=${slots.fontSize}, ` +
            `letterSpacing=${slots.letterSpacing}, ` +
            `lineHeight=${slots.lineHeight}`,
        });
      }

      // Reorder this style to follow the previous synced one (or move to
      // the top when this is the first). Mirrors the web app's authoring
      // order (sortOrder). Best-effort — if the API rejects on a given
      // platform / version, log and continue.
      try {
        figma.moveLocalTextStyleAfter(textStyle, prevTextStyle);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        logs.push({
          type: "info",
          message: `Could not reorder "${token.name}" in Text Styles panel: ${msg}`,
        });
      }
      prevTextStyle = textStyle;
    }

    // 5c. Sync shadow composite tokens as Figma Effect Styles, and gradient
    // composite tokens as Figma Paint Styles. These don't map to Variables or
    // Text Styles. Effect/Paint styles carry no Convex-side id field, so we
    // recover them by name each run (same orphan-by-name idea as text styles).

    /** Strip a unit and return a number (px-ish). 0 on failure. */
    const toNum = (v: string | number | boolean | null): number => {
      if (typeof v === "number") return v;
      if (typeof v === "string") {
        const n = parseFloat(v);
        return Number.isNaN(n) ? 0 : n;
      }
      return 0;
    };

    /** Resolve a composite slot (raw/alias) to a number. */
    const slotNum = (
      sub: TokenValue | AliasValue | undefined,
      modeName: string
    ): number => (sub ? toNum(resolveLeafValue(sub, modeName, "")) : 0);

    /** Resolve a composite color slot (raw/alias) to Figma RGBA. */
    const slotColor = (
      sub: TokenValue | AliasValue | undefined,
      modeName: string
    ): RGBA | null => {
      if (!sub) return null;
      const leaf = resolveLeafValue(sub, modeName, "color");
      return typeof leaf === "string" ? parseColorToRGBA(leaf) : null;
    };

    /** Resolve a composite boolean slot (e.g. shadow `inset`). */
    const slotBool = (
      sub: TokenValue | AliasValue | undefined,
      modeName: string
    ): boolean => {
      if (!sub) return false;
      const leaf = resolveLeafValue(sub, modeName, "");
      return typeof leaf === "boolean" ? leaf : leaf === "true";
    };

    // Normalize a composite value into an array of layer slot-maps. Single
    // slot-maps become a one-element array so shadows/gradients share a path.
    const asLayers = (
      composite: CompositeValue
    ): Array<Record<string, TokenValue | AliasValue>> => {
      const v = composite.value as
        | Record<string, TokenValue | AliasValue>
        | Array<Record<string, TokenValue | AliasValue>>;
      return Array.isArray(v) ? v : [v];
    };

    let createdEffectStyles = 0;
    let updatedEffectStyles = 0;

    if (shadowTokens.length > 0) {
      logs.push({
        type: "info",
        message: `Syncing ${shadowTokens.length} shadow style(s)...`,
      });
    }

    for (const token of shadowTokens) {
      const modeName = Object.keys(token.values)[0];
      const composite = token.values[modeName] as CompositeValue | undefined;
      if (!composite || composite.type !== "composite") continue;

      const effects: Array<DropShadowEffect | InnerShadowEffect> = [];
      for (const layer of asLayers(composite)) {
        const color = slotColor(layer.color, modeName) ?? { r: 0, g: 0, b: 0, a: 1 };
        const offset = {
          x: slotNum(layer.offsetX, modeName),
          y: slotNum(layer.offsetY, modeName),
        };
        const radius = slotNum(layer.blur, modeName);
        const spread = slotNum(layer.spread, modeName);
        const inset = slotBool(layer.inset, modeName);
        if (inset) {
          effects.push({
            type: "INNER_SHADOW",
            color,
            offset,
            radius,
            spread,
            visible: true,
            blendMode: "NORMAL",
          });
        } else {
          effects.push({
            type: "DROP_SHADOW",
            color,
            offset,
            radius,
            spread,
            visible: true,
            blendMode: "NORMAL",
            showShadowBehindNode: false,
          });
        }
      }

      if (effects.length === 0) {
        logs.push({
          type: "warning",
          message: `Skipped shadow "${token.name}" — no resolvable layers.`,
        });
        continue;
      }

      let style = figma.getLocalEffectStyles().find((s) => s.name === token.name);
      const isNew = !style;
      if (!style) style = figma.createEffectStyle();
      if (style.name !== token.name) style.name = token.name;
      style.effects = effects;
      if (isNew) {
        createdEffectStyles++;
      } else {
        updatedEffectStyles++;
      }
      logs.push({
        type: "info",
        message: `↳ ${token.name}: ${effects.length} shadow layer(s)`,
      });
    }

    let createdPaintStyles = 0;
    let updatedPaintStyles = 0;

    if (gradientTokens.length > 0) {
      logs.push({
        type: "info",
        message: `Syncing ${gradientTokens.length} gradient style(s)...`,
      });
    }

    for (const token of gradientTokens) {
      const modeName = Object.keys(token.values)[0];
      const composite = token.values[modeName] as CompositeValue | undefined;
      if (!composite || composite.type !== "composite") continue;

      const layers = asLayers(composite);
      // Each stop is a slot-map with a color and a position. Accept a few
      // common key spellings so this is tolerant of how the token was authored.
      const stops: ColorStop[] = [];
      for (const layer of layers) {
        const colorSub = layer.color ?? layer.stopColor;
        const posSub = layer.position ?? layer.stop ?? layer.offset;
        const color = slotColor(colorSub, modeName);
        if (!color) continue;
        // Position may be "0%"/"100%", 0..1, or 0..100.
        const rawPos = posSub ? resolveLeafValue(posSub, modeName, "") : null;
        let position: number;
        if (typeof rawPos === "string" && rawPos.trim().endsWith("%")) {
          position = parseFloat(rawPos) / 100;
        } else {
          const n = toNum(rawPos);
          position = n > 1 ? n / 100 : n;
        }
        stops.push({ position: Math.max(0, Math.min(1, position)), color });
      }

      if (stops.length < 2) {
        // Surface the shape we actually saw so it can be matched precisely.
        const seenKeys = Array.from(
          new Set(layers.flatMap((l) => Object.keys(l)))
        ).join(", ");
        logs.push({
          type: "warning",
          message: `Skipped gradient "${token.name}" — need ≥2 color stops, parsed ${stops.length}. Layer slots seen: [${seenKeys}] across ${layers.length} layer(s).`,
        });
        continue;
      }

      // Default to a vertical (top→bottom) linear gradient. Figma's
      // gradientTransform maps the [0,1] gradient axis onto the paint's
      // bounding box; this matrix runs it down the Y axis.
      const paint: GradientPaint = {
        type: "GRADIENT_LINEAR",
        gradientTransform: [
          [0, 1, 0],
          [-1, 0, 1],
        ],
        gradientStops: stops.sort((a, b) => a.position - b.position),
        visible: true,
        opacity: 1,
        blendMode: "NORMAL",
      };

      let style = figma.getLocalPaintStyles().find((s) => s.name === token.name);
      const isNew = !style;
      if (!style) style = figma.createPaintStyle();
      if (style.name !== token.name) style.name = token.name;
      style.paints = [paint];
      if (isNew) {
        createdPaintStyles++;
      } else {
        updatedPaintStyles++;
      }
      logs.push({
        type: "info",
        message: `↳ ${token.name}: linear gradient, ${stops.length} stop(s)`,
      });
    }

    // 6. Report new IDs back to server
    if (idsToReport.collections.length > 0 || idsToReport.tokens.length > 0) {
      logs.push({ type: "info", message: "Saving Figma IDs to server..." });
      await syncFigmaIds(apiKey, idsToReport);
      logs.push({ type: "success", message: "Figma IDs saved" });
    }

    const styleSummary =
      compositeTokens.length > 0
        ? ` Text Styles: ${createdStyles} created, ${updatedStyles} updated` +
          (skippedStyles > 0 ? `, ${skippedStyles} skipped` : "") +
          "."
        : "";

    const effectSummary =
      shadowTokens.length > 0
        ? ` Effect Styles: ${createdEffectStyles} created, ${updatedEffectStyles} updated.`
        : "";

    const paintSummary =
      gradientTokens.length > 0
        ? ` Paint Styles: ${createdPaintStyles} created, ${updatedPaintStyles} updated.`
        : "";

    const updatedTokens = updatedTokenIds.size;
    logs.push({
      type: "success",
      message:
        `Sync complete! ` +
        `Collections: ${createdCollections} created, ${updatedCollections} updated. ` +
        `Tokens: ${createdTokens} created, ${updatedTokens} updated.` +
        styleSummary +
        effectSummary +
        paintSummary,
    });

    // 7. Detect stale variables (manual-sync only). A variable is "stale"
    //    if it sits in a collection this sync wrote into but its id wasn't
    //    among the ones we created or matched to a DSB token / figma-only
    //    token this run. Common causes: DSB token renamed (we recreate
    //    rather than rename when type changes) or removed, or a designer
    //    manually authored a variable inside a synced collection.
    let staleVariables: StaleVariable[] | undefined;
    if (options.detectStale) {
      // Use the dedicated `touchedVariableIds` set rather than reading
      // from idsToReport.* — that one only fires when a new link is
      // created (or an orphan is matched), so a pure value-update on an
      // existing variable would be missing and incorrectly flagged stale.
      const stale: StaleVariable[] = [];
      for (const collId of syncedFigmaCollectionIds) {
        const coll = figma.variables.getVariableCollectionById(collId);
        if (!coll) continue;
        for (const varId of coll.variableIds) {
          if (touchedVariableIds.has(varId)) continue;
          const v = figma.variables.getVariableById(varId);
          if (!v) continue;
          stale.push({
            id: v.id,
            name: v.name,
            collectionName: coll.name,
            resolvedType: v.resolvedType,
            kind: "variable",
          });
        }
      }

      // Text-style stale detection. Flag every local text style whose id
      // wasn't touched this run. That catches duplicates (a current DSB
      // composite token's style with a different id), orphans of tokens
      // deleted from DSB, and styles renamed away. Yes, this also surfaces
      // any user-authored text style — but the UI defaults every entry to
      // unchecked, so deletion is always an explicit opt-in, and an
      // out-of-scope style at the top of the list is easier to dismiss
      // than a missing orphan is to find by hand.
      for (const style of figma.getLocalTextStyles()) {
        if (touchedTextStyleIds.has(style.id)) continue;
        stale.push({
          id: style.id,
          name: style.name,
          collectionName: "Text Styles",
          resolvedType: "TEXT_STYLE",
          kind: "textStyle",
        });
      }

      // Sort by collection then name for a stable, readable UI.
      stale.sort((a, b) => {
        if (a.collectionName !== b.collectionName) {
          return a.collectionName.localeCompare(b.collectionName);
        }
        return a.name.localeCompare(b.name);
      });
      staleVariables = stale;
      if (stale.length > 0) {
        const varCount = stale.filter((s) => s.kind !== "textStyle").length;
        const styleCount = stale.length - varCount;
        const parts: string[] = [];
        if (varCount > 0)
          parts.push(`${varCount} variable${varCount === 1 ? "" : "s"}`);
        if (styleCount > 0)
          parts.push(`${styleCount} text style${styleCount === 1 ? "" : "s"}`);
        logs.push({
          type: "info",
          message: `${parts.join(", ")} potentially stale`,
        });
      }
    }

    return {
      success: true,
      logs,
      createdCollections,
      updatedCollections,
      createdTokens,
      updatedTokens,
      designSystemName,
      staleVariables,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logs.push({ type: "error", message: `Sync failed: ${message}` });

    // Flush any IDs we managed to capture before the error so the next sync
    // can find existing variables by id instead of recreating them. Without
    // this, a partial failure leaves orphans in Figma that aren't linked on
    // Convex — which has caused renamed-token-creates-duplicate scenarios.
    if (
      apiKey &&
      (idsToReport.collections.length > 0 || idsToReport.tokens.length > 0)
    ) {
      try {
        await syncFigmaIds(apiKey, idsToReport);
        logs.push({
          type: "info",
          message: `Saved ${idsToReport.tokens.length} token id(s) before failure`,
        });
      } catch {
        // Best effort. The error we surface to the user is the original.
      }
    }

    return {
      success: false,
      logs,
      createdCollections,
      updatedCollections,
      createdTokens,
      updatedTokens: updatedTokenIds.size,
      designSystemName,
    };
  }
}

function syncModes(figmaCollection: VariableCollection, modes: string[]): void {
  const existingModes = figmaCollection.modes;

  // Rename or create modes to match
  for (let i = 0; i < modes.length; i++) {
    const modeName = modes[i];

    if (i < existingModes.length) {
      // Rename existing mode if needed
      if (existingModes[i].name !== modeName) {
        figmaCollection.renameMode(existingModes[i].modeId, modeName);
      }
    } else {
      // Add new mode
      figmaCollection.addMode(modeName);
    }
  }

  // Note: We don't remove extra modes to avoid data loss
  // Figma requires at least one mode anyway
}

function getModeId(figmaCollection: VariableCollection, modeName: string): string | null {
  const mode = figmaCollection.modes.find((m) => m.name === modeName);
  return mode?.modeId ?? null;
}

// Change types for diff view
export interface PendingChange {
  type: "add" | "modify" | "delete";
  itemType: "collection" | "token";
  name: string;
  oldName?: string;
  collectionName?: string;
}

export interface PendingChangesResult {
  count: number;
  changes: PendingChange[];
  designSystemName?: string;
}

// Check for pending updates without syncing
export async function checkForUpdates(apiKey: string): Promise<PendingChangesResult> {
  try {
    const { designSystem, collections, tokens } = await fetchTokens(apiKey);

    const changes: PendingChange[] = [];

    // Build collection name lookup
    const collectionNames = new Map<string, string>();
    for (const collection of collections) {
      collectionNames.set(collection._id, collection.name);
    }

    // Check collections
    for (const collection of collections) {
      if (!collection.figmaCollectionId) {
        // New collection
        changes.push({
          type: "add",
          itemType: "collection",
          name: collection.name,
        });
      } else {
        // Check if collection exists in Figma
        try {
          const figmaCollection = figma.variables.getVariableCollectionById(collection.figmaCollectionId);
          if (!figmaCollection) {
            changes.push({
              type: "add",
              itemType: "collection",
              name: collection.name,
            });
          } else if (figmaCollection.name !== collection.name) {
            changes.push({
              type: "modify",
              itemType: "collection",
              name: collection.name,
              oldName: figmaCollection.name,
            });
          }
        } catch {
          changes.push({
            type: "add",
            itemType: "collection",
            name: collection.name,
          });
        }
      }
    }

    // Check tokens
    for (const token of tokens) {
      const collectionName = collectionNames.get(token.collectionId);

      // Composite tokens (DTCG typography) sync to Figma Text Styles, NOT
      // Variables. They never get a figmaVariableId, so the variable check
      // below would always report them as "new" — that was the false-positive
      // "updates available" loop. Branch here on the value shape.
      if (isCompositeToken(token)) {
        if (!token.figmaTextStyleId) {
          changes.push({
            type: "add",
            itemType: "token",
            name: token.name,
            collectionName,
          });
          continue;
        }
        try {
          const style = figma.getStyleById(token.figmaTextStyleId);
          // Tombstone or wrong type → treat as missing
          if (!style || style.type !== "TEXT" || (style as { removed?: boolean }).removed) {
            changes.push({
              type: "add",
              itemType: "token",
              name: token.name,
              collectionName,
            });
          } else if (style.name !== token.name) {
            changes.push({
              type: "modify",
              itemType: "token",
              name: token.name,
              oldName: style.name,
              collectionName,
            });
          }
        } catch {
          changes.push({
            type: "add",
            itemType: "token",
            name: token.name,
            collectionName,
          });
        }
        continue;
      }

      if (!token.figmaVariableId) {
        // New token
        changes.push({
          type: "add",
          itemType: "token",
          name: token.name,
          collectionName,
        });
      } else {
        // Check if variable exists in Figma
        try {
          const figmaVariable = figma.variables.getVariableById(token.figmaVariableId);
          // Treat tombstones as missing.
          if (
            !figmaVariable ||
            (figmaVariable as { removed?: boolean }).removed
          ) {
            changes.push({
              type: "add",
              itemType: "token",
              name: token.name,
              collectionName,
            });
          } else if (figmaVariable.name !== token.name) {
            changes.push({
              type: "modify",
              itemType: "token",
              name: token.name,
              oldName: figmaVariable.name,
              collectionName,
            });
          }
        } catch {
          changes.push({
            type: "add",
            itemType: "token",
            name: token.name,
            collectionName,
          });
        }
      }
    }

    return {
      count: changes.length,
      changes,
      designSystemName: designSystem.name,
    };
  } catch {
    return { count: 0, changes: [] };
  }
}
