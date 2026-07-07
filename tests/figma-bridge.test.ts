/**
 * The Tailwind → Figma bridge: `$tw` refs sync as aliases to a synthetic
 * read-only "Tailwind" collection (tree-shaken in "used", whole theme in
 * "full"), and stay baked to raw when the bridge is "off".
 */

import { describe, expect, it } from "vitest";
import { buildFigmaTokensPayload } from "../src/server/figma";
import type { CollectionDoc, SystemDoc } from "../src/core/types";

const EMPTY_IDS = { collections: {}, tokens: {} };

const baseSystem = (
  bridge: SystemDoc["tailwindFigmaBridge"]
): SystemDoc => ({
  name: "DS",
  fluid: { viewport: { minWidth: 360, maxWidth: 1440 }, breakpoints: [] },
  useTailwindColors: true,
  tailwindFigmaBridge: bridge,
  collections: ["semantic"],
});

const semantic: CollectionDoc = {
  name: "semantic",
  modes: ["default"],
  tokens: [
    { name: "text.weight", type: "fontWeight", values: { default: { type: "tailwind", color: "font-bold" } } },
    {
      name: "text.heading",
      type: "typography",
      values: {
        default: {
          type: "composite",
          layers: {
            fontWeight: { type: "tailwind", color: "font-semibold" },
            lineHeight: { type: "tailwind", color: "leading-snug" },
            fontSize: { type: "raw", value: "1.5rem" },
          },
        },
      },
    },
  ],
};

type PayloadToken = {
  _id: string;
  collectionId: string;
  name: string;
  type: string;
  values: Record<string, { type: string; value?: unknown; tokenId?: string;
    value_?: unknown }>;
};
type PayloadCollection = { _id: string; name: string; readOnly?: boolean };

const build = (bridge: SystemDoc["tailwindFigmaBridge"]) => {
  const p = buildFigmaTokensPayload(baseSystem(bridge), [semantic], EMPTY_IDS) as {
    collections: PayloadCollection[];
    tokens: PayloadToken[];
  };
  return {
    collections: p.collections,
    tokens: p.tokens,
    byId: (id: string) => p.tokens.find((t) => t._id === id),
    tailwindCol: p.collections.find((c) => c._id === "Tailwind"),
  };
};

describe("bridge off (default)", () => {
  const p = build("off");
  it("bakes $tw to raw and emits no Tailwind collection", () => {
    expect(p.byId("text.weight")!.values.default).toEqual({ type: "raw", value: "700" });
    expect(p.tailwindCol).toBeUndefined();
  });
  it("bakes composite $tw slots to raw", () => {
    const composite = p.byId("text.heading")!.values.default as unknown as {
      value: Record<string, { type: string; value?: unknown; tokenId?: string }>;
    };
    expect(composite.value.fontWeight).toEqual({ type: "raw", value: "600" });
    expect(composite.value.lineHeight).toEqual({ type: "raw", value: "1.375" });
  });
});

describe("bridge used (tree-shaken)", () => {
  const p = build("used");
  it("aliases $tw tokens to the Tailwind collection", () => {
    expect(p.byId("text.weight")!.values.default).toEqual({
      type: "alias",
      tokenId: "tw/font-weight/bold",
    });
  });
  it("aliases composite $tw slots", () => {
    const composite = p.byId("text.heading")!.values.default as unknown as {
      value: Record<string, { type: string; tokenId?: string }>;
    };
    expect(composite.value.fontWeight).toEqual({ type: "alias", tokenId: "tw/font-weight/semibold" });
    expect(composite.value.lineHeight).toEqual({ type: "alias", tokenId: "tw/leading/snug" });
    expect(composite.value.fontSize).toEqual({ type: "raw", value: "1.5rem" });
  });
  it("emits a read-only Tailwind collection with ONLY the referenced vars", () => {
    expect(p.tailwindCol).toMatchObject({ name: "Tailwind", readOnly: true });
    const twTokens = p.tokens.filter((t) => t.collectionId === "Tailwind");
    const ids = twTokens.map((t) => t._id).sort();
    expect(ids).toEqual([
      "tw/font-weight/bold",
      "tw/font-weight/semibold",
      "tw/leading/snug",
    ]);
    const bold = twTokens.find((t) => t._id === "tw/font-weight/bold")!;
    expect(bold.name).toBe("font-weight/bold");
    expect(bold.type).toBe("fontWeight");
    expect(bold.values.default).toEqual({ type: "raw", value: "700" });
  });
});

describe("bridge full (whole theme)", () => {
  const p = build("full");
  it("still aliases referenced tokens", () => {
    expect(p.byId("text.weight")!.values.default).toEqual({
      type: "alias",
      tokenId: "tw/font-weight/bold",
    });
  });
  it("emits the entire theme, not just the used vars", () => {
    const twTokens = p.tokens.filter((t) => t.collectionId === "Tailwind");
    // Full theme is hundreds of vars (colors + every scale).
    expect(twTokens.length).toBeGreaterThan(200);
    expect(twTokens.some((t) => t._id === "tw/color/slate/500")).toBe(true);
    expect(twTokens.some((t) => t._id === "tw/spacing/4")).toBe(true);
  });
});
