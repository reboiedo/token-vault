/**
 * `$tw` references resolve Tailwind v4 default-theme utilities (not just
 * colors) to their raw CSS value, and the utility lookup table is sane.
 */

import { describe, expect, it } from "vitest";
import { buildResolver } from "../src/core/resolve";
import { getTailwindUtility, TAILWIND_THEME } from "../src/core/tailwind-theme";
import type { CollectionDoc } from "../src/core/types";

const collection = (name: string, tokens: CollectionDoc["tokens"]): CollectionDoc => ({
  name,
  modes: ["default"],
  tokens,
});

describe("getTailwindUtility", () => {
  it("resolves the typography scales the user asked for", () => {
    expect(getTailwindUtility("font-bold")?.value).toBe("700");
    expect(getTailwindUtility("leading-tight")?.value).toBe("1.25");
    expect(getTailwindUtility("tracking-wide")?.value).toBe("0.025em");
    expect(getTailwindUtility("text-lg")?.value).toBe("1.125rem");
  });

  it("computes spacing steps as multiples of 0.25rem", () => {
    expect(getTailwindUtility("spacing-4")?.value).toBe("1rem");
    expect(getTailwindUtility("spacing-0")?.value).toBe("0px");
    expect(getTailwindUtility("spacing-px")?.value).toBe("1px");
  });

  it("returns null for unknown refs and bare colors", () => {
    expect(getTailwindUtility("nonsense-9")).toBeNull();
    expect(getTailwindUtility("slate-500")).toBeNull(); // colors live elsewhere
  });

  it("carries a token type and a Tailwind var for every entry", () => {
    for (const scale of TAILWIND_THEME) {
      for (const entry of scale.entries) {
        expect(entry.ref).toContain("-");
        expect(entry.value.length).toBeGreaterThan(0);
        expect(entry.cssVar.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("resolver resolves $tw utilities", () => {
  const resolver = buildResolver([
    collection("core", [
      { name: "text.weight.bold", type: "fontWeight", values: { default: { type: "tailwind", color: "font-bold" } } },
      { name: "text.leading", type: "number", values: { default: { type: "tailwind", color: "leading-relaxed" } } },
      { name: "text.tracking", type: "dimension", values: { default: { type: "tailwind", color: "tracking-widest" } } },
      // Alias pointing at a $tw utility token still resolves through.
      { name: "heading.weight", type: "fontWeight", values: { default: { type: "alias", token: "text.weight.bold" } } },
    ]),
  ]);

  it("resolves direct utility refs", () => {
    expect(resolver.resolveRaw("text.weight.bold")).toBe("700");
    expect(resolver.resolveRaw("text.leading")).toBe("1.625");
    expect(resolver.resolveRaw("text.tracking")).toBe("0.1em");
  });

  it("resolves through an alias to a utility token", () => {
    expect(resolver.resolveRaw("heading.weight")).toBe("700");
  });
});
