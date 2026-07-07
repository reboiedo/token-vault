/**
 * Surface recipes: the surfaces rules export as seed-driven relative
 * colors (CSS layer + DTCG group), APCA levels flagged approximate,
 * split-polarity levels emit on-light / on-dark, and the whole thing is
 * opt-in via `system.surfaceRecipes`.
 */

import { describe, expect, it } from "vitest";
import {
  buildSurfaceRecipes,
  recipesToCss,
  recipesToDtcgGroup,
} from "../src/core/surface-recipe";
import { generateDtcgExport } from "../src/core/dtcg-export";
import type { CollectionDoc, SystemDoc } from "../src/core/types";
import type { SurfacesConfig } from "../src/core/surfaces-utils";

const surfacesConfig: SurfacesConfig = {
  surfaces: [
    {
      id: "s1",
      name: "primary",
      baseByMode: {
        light: { kind: "raw", value: "#3b82f6" },
        dark: { kind: "raw", value: "#1e3a8a" },
      },
    },
  ],
  levels: [
    // mix toward ink → color-mix, identical branches → single css
    {
      id: "l1",
      name: "fg-muted",
      rule: {
        kind: "fg",
        onLight: { target: { kind: "mix", mix: 0.7 }, anchor: { kind: "auto" } },
        onDark: { target: { kind: "mix", mix: 0.7 }, anchor: { kind: "auto" } },
      },
    },
    // APCA contrast target → approximate color-mix, flagged approx
    {
      id: "l2",
      name: "fg",
      rule: {
        kind: "fg",
        onLight: { target: { kind: "apca", lc: 60 }, anchor: { kind: "auto" } },
        onDark: { target: { kind: "apca", lc: 60 }, anchor: { kind: "auto" } },
      },
    },
    // surface-shift with stepStrength → polarity flips ΔL → split branches
    {
      id: "l3",
      name: "hover",
      rule: {
        kind: "surface-shift",
        onLight: { stepStrength: 0.1 },
        onDark: { stepStrength: 0.1 },
      },
    },
    // opacity → rgb(from … / α)
    {
      id: "l4",
      name: "overlay",
      rule: {
        kind: "opacity",
        source: "surface",
        onLight: { alpha: 0.5 },
        onDark: { alpha: 0.5 },
      },
    },
  ],
};

const collection: CollectionDoc = {
  name: "semantic",
  modes: ["light", "dark"],
  surfacesConfig,
  tokens: [],
};

describe("buildSurfaceRecipes", () => {
  const recipes = buildSurfaceRecipes([collection]);
  const byLevel = (l: string) => recipes.find((r) => r.level === l)!;

  it("emits a mix level as a single seed-driven color-mix", () => {
    const r = byLevel("fg-muted");
    expect(r.approx).toBe(false);
    expect(r.css).toContain("color-mix(in oklch, var(--surface)");
    expect(r.css).toContain("var(--ink)");
  });

  it("flags APCA levels approximate", () => {
    const r = byLevel("fg");
    expect(r.approx).toBe(true);
    expect(r.css).toContain("color-mix(in oklch");
  });

  it("splits surface-shift into on-light / on-dark (polarity flips ΔL)", () => {
    const r = byLevel("hover");
    expect(r.css).toBeUndefined();
    expect(r.onLight).toContain("oklch(from var(--surface) calc(l - 0.06)");
    expect(r.onDark).toContain("oklch(from var(--surface) calc(l + 0.06)");
  });

  it("emits opacity as rgb(from … / α)", () => {
    expect(byLevel("overlay").css).toBe("rgb(from var(--surface) r g b / 0.5)");
  });
});

describe("recipesToCss", () => {
  const css = recipesToCss(buildSurfaceRecipes([collection]));

  it("wraps everything in :root with seed-relative custom properties", () => {
    expect(css).toContain(":root {");
    expect(css).toContain("--fg-muted: color-mix(in oklch, var(--surface)");
    expect(css).toContain("--overlay: rgb(from var(--surface) r g b / 0.5);");
  });

  it("emits both polarity branches for split levels", () => {
    expect(css).toContain("--hover-on-light: oklch(from var(--surface) calc(l - 0.06)");
    expect(css).toContain("--hover-on-dark: oklch(from var(--surface) calc(l + 0.06)");
  });

  it("tags approximate (APCA) levels in a comment", () => {
    const fgLine = css.split("\n").find((l) => l.trimStart().startsWith("--fg:"))!;
    expect(fgLine).toContain("/* approx */");
  });
});

describe("recipesToDtcgGroup", () => {
  const group = recipesToDtcgGroup(buildSurfaceRecipes([collection])) as Record<
    string,
    Record<string, unknown>
  >;

  it("emits color tokens whose $value is the relative expression", () => {
    expect(group["fg-muted"].$type).toBe("color");
    expect(String(group["fg-muted"].$value)).toContain("color-mix(in oklch, var(--surface)");
  });

  it("marks APCA tokens approx under $extensions", () => {
    const ext = group["fg"].$extensions as Record<string, Record<string, Record<string, unknown>>>;
    expect(ext["com.designsystembuilder"].surfaceRecipe.approx).toBe(true);
  });

  it("nests split levels under on-light / on-dark", () => {
    const hover = group["hover"] as Record<string, Record<string, unknown>>;
    expect(String(hover["on-light"].$value)).toContain("calc(l - 0.06)");
    expect(String(hover["on-dark"].$value)).toContain("calc(l + 0.06)");
  });
});

describe("generateDtcgExport gating", () => {
  const system = (surfaceRecipes: SystemDoc["surfaceRecipes"]): SystemDoc => ({
    name: "DS",
    fluid: { viewport: { minWidth: 360, maxWidth: 1440 }, breakpoints: [] },
    surfaceRecipes,
    collections: ["semantic"],
  });

  it("omits the surface-recipe group when off", () => {
    const out = generateDtcgExport(system("off"), [collection]);
    expect(out.tokens["surface-recipe"]).toBeUndefined();
  });

  it("injects the surface-recipe group when dtcg/both", () => {
    const out = generateDtcgExport(system("both"), [collection]);
    expect(out.tokens["surface-recipe"]).toBeDefined();
  });
});
