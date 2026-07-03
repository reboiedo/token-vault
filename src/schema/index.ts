/**
 * Source-file schema + codec.
 *
 * token-vault's source of truth is a `design-system/` folder:
 *
 *   design-system/
 *   ├── system.json          — SystemFile
 *   └── collections/<n>.json — CollectionFile
 *
 * Files store *editable intent* with a compact, human-diffable value
 * encoding (the Tokens-Studio-style shorthand):
 *
 *   "…" / 1.5 / true                → raw
 *   "{color.blue.600}"              → alias (by dotted name)
 *   { "$tw": "slate-500" }          → tailwind palette ref
 *   { "$derive": { base, ops } }    → OKLCH derivation pipeline
 *   { "$expr": "container * 0.5" }  → dimension expression
 *   { "$composite": {…} | [{…}] }   → DTCG composite (slots raw/alias)
 *
 * `decode*` turns file JSON into the canonical documents in
 * `core/types`; `encode*` is its exact inverse (used by the store when
 * writing). Generated tokens are never encoded — they are recomputed.
 */

import { z } from "zod";
import type {
  AliasValue,
  CollectionDoc,
  CompositeLayer,
  CompositeSlot,
  DerivationBase,
  DerivationOp,
  GeneratorDef,
  SystemDoc,
  TokenDoc,
  TokenType,
  TokenValue,
} from "../core/types";

// ============================================================================
// VALUE ENCODING (file shape)
// ============================================================================

const ALIAS_RE = /^\{([^{}]+)\}$/;

const derivationBaseSchema: z.ZodType<DerivationBase> = z.union([
  z.object({ kind: z.literal("token"), token: z.string() }).strict(),
  z.object({ kind: z.literal("tailwind"), color: z.string() }).strict(),
  z.object({ kind: z.literal("raw"), value: z.string() }).strict(),
]);

const derivationOpSchema: z.ZodType<DerivationOp> = z.union([
  z.object({ op: z.literal("lighten"), amount: z.number() }).strict(),
  z.object({ op: z.literal("darken"), amount: z.number() }).strict(),
  z.object({ op: z.literal("mute"), amount: z.number() }).strict(),
  z
    .object({ op: z.literal("mix"), with: z.string(), weight: z.number() })
    .strict(),
  z
    .object({
      op: z.literal("autoContrast"),
      light: z.string().optional(),
      dark: z.string().optional(),
      threshold: z.number().optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("shift"),
      stepStrength: z.number(),
      chromaDelta: z.number().optional(),
    })
    .strict(),
]);

/** One composite slot in file form: plain raw or "{alias}". */
const fileCompositeSlotSchema = z.union([z.string(), z.number(), z.boolean()]);
const fileCompositeLayerSchema = z.record(z.string(), fileCompositeSlotSchema);

/** A token value in file form. */
export const fileValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.object({ $tw: z.string() }).strict(),
  z
    .object({
      $derive: z
        .object({
          base: derivationBaseSchema,
          ops: z.array(derivationOpSchema),
        })
        .strict(),
    })
    .strict(),
  z.object({ $expr: z.string() }).strict(),
  z
    .object({
      $composite: z.union([
        fileCompositeLayerSchema,
        z.array(fileCompositeLayerSchema),
      ]),
    })
    .strict(),
]);
export type FileValue = z.infer<typeof fileValueSchema>;

function decodeCompositeSlot(v: string | number | boolean): CompositeSlot {
  if (typeof v === "string") {
    const m = ALIAS_RE.exec(v);
    if (m) return { type: "alias", token: m[1] };
  }
  return { type: "raw", value: v };
}

function encodeCompositeSlot(slot: CompositeSlot): string | number | boolean {
  if (slot.type === "alias") return `{${slot.token}}`;
  return slot.value;
}

export function decodeValue(v: FileValue): TokenValue {
  if (typeof v === "string") {
    const m = ALIAS_RE.exec(v);
    if (m) return { type: "alias", token: m[1] } satisfies AliasValue;
    return { type: "raw", value: v };
  }
  if (typeof v === "number" || typeof v === "boolean") {
    return { type: "raw", value: v };
  }
  if ("$tw" in v) return { type: "tailwind", color: v.$tw };
  if ("$derive" in v)
    return { type: "derived", base: v.$derive.base, ops: v.$derive.ops };
  if ("$expr" in v) return { type: "expression", formula: v.$expr };
  const layers = v.$composite;
  const decodeLayer = (l: Record<string, string | number | boolean>) => {
    const out: CompositeLayer = {};
    for (const [slot, sv] of Object.entries(l)) out[slot] = decodeCompositeSlot(sv);
    return out;
  };
  return {
    type: "composite",
    layers: Array.isArray(layers) ? layers.map(decodeLayer) : decodeLayer(layers),
  };
}

export function encodeValue(value: TokenValue): FileValue {
  switch (value.type) {
    case "raw":
      return value.value;
    case "alias":
      return `{${value.token}}`;
    case "tailwind":
      return { $tw: value.color };
    case "derived":
      return { $derive: { base: value.base, ops: value.ops } };
    case "expression":
      return { $expr: value.formula };
    case "composite": {
      const encodeLayer = (l: CompositeLayer) => {
        const out: Record<string, string | number | boolean> = {};
        for (const [slot, sv] of Object.entries(l)) out[slot] = encodeCompositeSlot(sv);
        return out;
      };
      return {
        $composite: Array.isArray(value.layers)
          ? value.layers.map(encodeLayer)
          : encodeLayer(value.layers),
      };
    }
  }
}

// ============================================================================
// GENERATOR CONFIGS
// ============================================================================

const channelConfigSchema = z
  .object({
    start: z.number(),
    end: z.number(),
    curve: z.string(),
    customBezier: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
    overrides: z
      .record(
        z.string(),
        z.union([
          z.number(),
          z
            .object({
              value: z.number(),
              handles: z.unknown().optional(),
              inHandle: z.unknown().optional(),
              outHandle: z.unknown().optional(),
            })
            .loose(),
        ])
      )
      .optional(),
  })
  .loose();

const colorScaleConfigSchema = z
  .object({
    steps: z.array(z.string()),
    families: z.array(
      z
        .object({
          name: z.string(),
          lightness: channelConfigSchema,
          chroma: channelConfigSchema,
          hue: channelConfigSchema,
        })
        .loose()
    ),
    syncedChannels: z
      .object({
        lightness: z.boolean().optional(),
        chroma: z.boolean().optional(),
        hue: z.boolean().optional(),
      })
      .optional(),
  })
  .loose();

const spacingConfigSchema = z
  .object({
    baseMin: z.number(),
    baseMax: z.number(),
    steps: z.array(z.object({ name: z.string(), multiplier: z.number() })),
    fixedSteps: z.array(z.object({ value: z.number() })).optional(),
    includePairs: z.boolean(),
    customPairs: z.array(z.object({ from: z.string(), to: z.string() })),
    unit: z.enum(["rem", "px"]),
    prefix: z.string(),
  })
  .loose();

const typographyConfigSchema = z
  .object({
    steps: z.array(z.object({ minPx: z.number(), maxPx: z.number() })),
    unit: z.enum(["rem", "px"]),
    prefix: z.string(),
    baseStepIndex: z.number().optional(),
  })
  .loose();

const generatorSchema = z.union([
  z.object({
    id: z.string(),
    type: z.literal("color"),
    groupPrefix: z.string(),
    config: z.object({
      type: z.literal("color"),
      colorScaleConfig: colorScaleConfigSchema,
    }),
  }),
  z.object({
    id: z.string(),
    type: z.literal("spacing"),
    groupPrefix: z.string(),
    config: z.object({
      type: z.literal("spacing"),
      spacingConfig: spacingConfigSchema,
    }),
  }),
  z.object({
    id: z.string(),
    type: z.literal("typography"),
    groupPrefix: z.string(),
    config: z.object({
      type: z.literal("typography"),
      typographyConfig: typographyConfigSchema,
    }),
  }),
]);

// ============================================================================
// SURFACES CONFIG — mirrors core/surfaces-utils' current shapes
// (legacy variants deliberately unsupported: the format is born clean).
// ============================================================================

const surfaceBaseValueSchema = z.union([
  z.object({ kind: z.literal("raw"), value: z.string() }),
  z.object({ kind: z.literal("alias"), token: z.string() }),
  z.object({
    kind: z.literal("derived"),
    base: derivationBaseSchema,
    ops: z.array(derivationOpSchema),
  }),
]);

const surfaceAnchorSchema = z.union([
  z.object({ kind: z.literal("auto") }),
  z.object({ kind: z.literal("raw"), value: z.string() }),
  z.object({ kind: z.literal("alias"), token: z.string() }),
  z.object({ kind: z.literal("tailwind"), color: z.string() }),
  z.object({ kind: z.literal("surface") }),
]);

const surfaceFgChoiceSchema = z.union([
  z.object({ kind: z.literal("auto") }),
  z.object({ kind: z.literal("light") }),
  z.object({ kind: z.literal("dark") }),
  z.object({ kind: z.literal("alias"), token: z.string() }),
  z.object({ kind: z.literal("tailwind"), color: z.string() }),
]);

const surfaceMeasureRefSchema = z.union([
  z.object({ kind: z.literal("surface") }),
  z.object({ kind: z.literal("level"), levelId: z.string() }),
  z.object({ kind: z.literal("alias"), token: z.string() }),
  z.object({ kind: z.literal("tailwind"), color: z.string() }),
]);

const surfaceFgTargetSchema = z.union([
  z.object({ kind: z.literal("apca"), lc: z.number() }),
  z.object({ kind: z.literal("mix"), mix: z.number() }),
]);

const surfaceFgBranchSchema = z.object({
  target: surfaceFgTargetSchema,
  anchor: surfaceAnchorSchema,
  measureAgainst: surfaceMeasureRefSchema.optional(),
});

const surfaceShiftBranchSchema = z.object({
  stepStrength: z.number().optional(),
  lightnessDelta: z.number().optional(),
  chromaDelta: z.number().optional(),
  mixWith: z
    .union([
      z.object({ token: z.string(), weight: z.number() }),
      z.object({ tailwind: z.string(), weight: z.number() }),
    ])
    .optional(),
});

const surfaceMixBranchSchema = z.object({
  mix: z.number(),
  anchor: surfaceAnchorSchema,
});

const surfaceOpacityBranchSchema = z.object({ alpha: z.number() });

const surfaceScaleStepBranchSchema = z.object({
  step: z.string(),
  scale: z
    .union([
      z.object({ kind: z.literal("parent") }),
      z.object({ kind: z.literal("alias"), token: z.string() }),
      z.object({ kind: z.literal("tailwind"), family: z.string() }),
    ])
    .optional(),
});

const surfaceLevelRuleSchema = z.union([
  z.object({
    kind: z.literal("fg"),
    onLight: surfaceFgBranchSchema,
    onDark: surfaceFgBranchSchema,
  }),
  z.object({
    kind: z.literal("surface-shift"),
    onLight: surfaceShiftBranchSchema,
    onDark: surfaceShiftBranchSchema,
  }),
  z.object({
    kind: z.literal("surface-mix"),
    onLight: surfaceMixBranchSchema,
    onDark: surfaceMixBranchSchema,
  }),
  z.object({
    kind: z.literal("opacity"),
    source: z.union([
      z.literal("surface"),
      z.literal("fg"),
      z.object({ kind: z.literal("alias"), token: z.string() }),
      z.object({ kind: z.literal("tailwind"), color: z.string() }),
    ]),
    bake: z.enum(["composite", "alpha"]).optional(),
    onLight: surfaceOpacityBranchSchema,
    onDark: surfaceOpacityBranchSchema,
  }),
  z.object({
    kind: z.literal("scale-step"),
    onLight: surfaceScaleStepBranchSchema,
    onDark: surfaceScaleStepBranchSchema,
  }),
]);

const surfaceLevelSchema = z.object({
  id: z.string(),
  name: z.string(),
  rule: surfaceLevelRuleSchema,
  display: z.enum(["text", "separator", "bg"]).optional(),
});

const surfaceRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseByMode: z.record(z.string(), surfaceBaseValueSchema),
  fgByMode: z.record(z.string(), surfaceFgChoiceSchema).optional(),
  materializeBase: z.boolean().optional(),
  bareLevels: z.boolean().optional(),
  levelStates: z
    .record(
      z.string(),
      z.union([
        z.object({ state: z.literal("default") }),
        z.object({ state: z.literal("disabled") }),
      ])
    )
    .optional(),
});

export const surfacesConfigSchema = z.object({
  surfaces: z.array(surfaceRowSchema),
  levels: z.array(surfaceLevelSchema),
  contrastThreshold: z.number().optional(),
});

// ============================================================================
// FILES
// ============================================================================

const TOKEN_TYPES = [
  "color",
  "dimension",
  "fontFamily",
  "fontWeight",
  "duration",
  "cubicBezier",
  "transition",
  "number",
  "shadow",
  "border",
  "typography",
  "gradient",
  "string",
  "boolean",
] as const satisfies readonly TokenType[];

const fileTokenSchema = z.object({
  name: z.string().min(1),
  type: z.enum(TOKEN_TYPES).optional(),
  description: z.string().optional(),
  values: z.record(z.string(), fileValueSchema),
});

export const collectionFileSchema = z.object({
  $schema: z.string().optional(),
  name: z.string().min(1),
  modes: z.array(z.string().min(1)).min(1),
  groupOrder: z.array(z.string()).optional(),
  generators: z.array(generatorSchema).optional(),
  surfacesConfig: surfacesConfigSchema.optional(),
  tailwind: z
    .object({
      enabled: z.boolean(),
      utility: z.literal("spacing").optional(),
      semantic: z
        .object({ modeSelectors: z.record(z.string(), z.string()) })
        .optional(),
    })
    .optional(),
  tokens: z.array(fileTokenSchema).default([]),
});
export type CollectionFile = z.infer<typeof collectionFileSchema>;

export const systemFileSchema = z.object({
  $schema: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  fluid: z.object({
    viewport: z.object({ minWidth: z.number(), maxWidth: z.number() }),
    breakpoints: z.array(z.number()).default([]),
  }),
  useTailwindColors: z.boolean().optional(),
  exportLayout: z.enum(["single", "per-collection"]).optional(),
  collections: z.array(z.string().min(1)),
});
export type SystemFile = z.infer<typeof systemFileSchema>;

// ============================================================================
// DECODE / ENCODE — file shape ⇄ canonical documents
// ============================================================================

export function decodeSystem(file: SystemFile): SystemDoc {
  const { $schema: _s, ...rest } = file;
  return rest;
}

export function encodeSystem(doc: SystemDoc): SystemFile {
  return { ...doc };
}

export function decodeCollection(file: CollectionFile): CollectionDoc {
  return {
    name: file.name,
    modes: file.modes,
    groupOrder: file.groupOrder,
    generators: file.generators as GeneratorDef[] | undefined,
    surfacesConfig: file.surfacesConfig,
    tailwind: file.tailwind,
    tokens: file.tokens.map(
      (t): TokenDoc => ({
        name: t.name,
        type: t.type,
        description: t.description,
        values: Object.fromEntries(
          Object.entries(t.values).map(([mode, v]) => [mode, decodeValue(v)])
        ),
      })
    ),
  };
}

export function encodeCollection(doc: CollectionDoc): CollectionFile {
  return {
    name: doc.name,
    modes: doc.modes,
    ...(doc.groupOrder ? { groupOrder: doc.groupOrder } : {}),
    ...(doc.generators?.length
      ? { generators: doc.generators as CollectionFile["generators"] }
      : {}),
    ...(doc.surfacesConfig
      ? {
          surfacesConfig: doc.surfacesConfig as CollectionFile["surfacesConfig"],
        }
      : {}),
    ...(doc.tailwind ? { tailwind: doc.tailwind } : {}),
    // Generated tokens are never persisted — they are recomputed on load.
    tokens: doc.tokens
      .filter((t) => !t.generated)
      .map((t) => ({
        name: t.name,
        ...(t.type ? { type: t.type } : {}),
        ...(t.description ? { description: t.description } : {}),
        values: Object.fromEntries(
          Object.entries(t.values).map(([mode, v]) => [mode, encodeValue(v)])
        ),
      })),
  };
}
