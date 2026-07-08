// API client for Design System Builder / token-vault.
//
// Two sources, selected by the shape of the connection string the user
// enters in the "API Key" field:
//   · "dsb_…"                → cloud (Convex prod deployment)
//   · "http://localhost:4477" → local token-vault dev server
//     (its /api/figma/tokens + /api/figma/sync-ids mirror the cloud
//     contract; ids are token names and live in .figma-ids.json)
//
// Switch API_BASE_URL to the dev deployment
// (`tacit-vole-969.convex.site`) only when iterating locally on the
// Convex HTTP endpoints — most cloud users connect to prod.
const API_BASE_URL = "https://neat-narwhal-831.eu-west-1.convex.site";

/** True when the connection string is a local token-vault server URL. */
export function isLocalSource(keyOrUrl: string): boolean {
  return /^https?:\/\//i.test(keyOrUrl.trim());
}

function endpoints(keyOrUrl: string): { tokens: string; syncIds: string } {
  if (isLocalSource(keyOrUrl)) {
    const base = keyOrUrl.trim().replace(/\/+$/, "");
    return {
      tokens: `${base}/api/figma/tokens`,
      syncIds: `${base}/api/figma/sync-ids`,
    };
  }
  const key = encodeURIComponent(keyOrUrl);
  return {
    tokens: `${API_BASE_URL}/api/tokens?key=${key}`,
    syncIds: `${API_BASE_URL}/api/sync-figma-ids?key=${key}`,
  };
}

export interface FluidSettings {
  viewport: {
    minWidth: number;
    maxWidth: number;
  };
  breakpoints: number[];
}

export interface FigmaBundle {
  name: string;
  collectionIds: string[];
}

export interface DesignSystem {
  _id: string;
  name: string;
  description?: string;
  fluidSettings?: FluidSettings;
  figmaBundles?: FigmaBundle[];
  figmaOnlyTokens?: FigmaOnlyToken[];
}

export interface SpacingScaleConfig {
  viewport: {
    minWidth: number;
    maxWidth: number;
    minFontSize: number;
    maxFontSize: number;
  };
  breakpoints?: number[];
}

export interface Collection {
  _id: string;
  name: string;
  type?: "color" | "number" | "string" | "boolean";
  // Collection kinds: regular, color, spacing, typography, fluid (legacy)
  kind?: "regular" | "color" | "spacing" | "typography" | "fluid";
  modes: string[];
  sortOrder: number;
  figmaCollectionId?: string;
  // When this DSB collection contains both static and fluid tokens, the sync
  // splits them into two Figma collections. This is the id of the fluid one.
  figmaFluidCollectionId?: string;
  spacingScaleConfig?: SpacingScaleConfig;
}

export interface TokenValue {
  type: "raw";
  value: string | number | boolean;
}

export interface AliasValue {
  type: "alias";
  tokenId: string;
}

/**
 * Composite values (DTCG typography etc.) — `value` is a record of slot
 * names (`fontFamily`, `fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`)
 * each holding a raw or alias sub-value.
 */
export interface CompositeValue {
  type: "composite";
  value: Record<string, TokenValue | AliasValue>;
}

export interface Token {
  _id: string;
  collectionId: string;
  name: string;
  /** DTCG type (typography composites use "typography"). */
  type?: string;
  values: Record<string, TokenValue | AliasValue | CompositeValue>;
  /** Set when the token maps to a Figma Variable. */
  figmaVariableId?: string;
  /** Set when the token maps to a Figma Text Style (typography composites). */
  figmaTextStyleId?: string;
  // Spacing token metadata
  minPx?: number;
  maxPx?: number;
  /** Authoring order from the web app — used to keep Figma create order stable. */
  sortOrder?: number;
}

/**
 * Figma-only tokens — explicit per-breakpoint values that sync as Figma
 * variables in the chosen collection's fluid partition. Excluded from DTCG.
 * Used for things like grid column counts that vary per breakpoint but
 * don't belong in CSS.
 */
export interface FigmaOnlyToken {
  name: string;
  collectionId: string;
  // Keys are mode names like "@1024px"; values are raw numbers.
  valuesByBreakpoint: Record<string, number>;
  figmaVariableId?: string;
}

export interface FetchTokensResponse {
  designSystem: DesignSystem;
  collections: Collection[];
  tokens: Token[];
}

export interface SyncFigmaIdsRequest {
  // `figmaId` = static-partition id (or the only id if not split).
  // `figmaFluidId` = secondary id for the fluid partition, when present.
  collections: Array<{
    convexId: string;
    figmaId?: string;
    figmaFluidId?: string;
  }>;
  tokens: Array<{
    convexId: string;
    /** Figma Variable id (primitives) — at least one of figmaId / figmaTextStyleId is sent. */
    figmaId?: string;
    /** Figma Text Style id (typography composites). */
    figmaTextStyleId?: string;
  }>;
  /** Figma-only tokens are addressed by name, not Convex id. */
  figmaOnlyTokens?: Array<{
    name: string;
    figmaId: string;
  }>;
}

export async function fetchTokens(apiKey: string): Promise<FetchTokensResponse> {
  const response = await fetch(endpoints(apiKey).tokens);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export async function syncFigmaIds(apiKey: string, data: SyncFigmaIdsRequest): Promise<void> {
  const response = await fetch(endpoints(apiKey).syncIds, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
}
