/**
 * Rename-cascade coverage: renaming a token must rewrite every kind of
 * reference, across files, and persist only what changed. A miss here
 * corrupts source files silently — every value variant gets a case.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileStore } from "../src/store/file-store";
import { rewriteValue } from "../src/store/rewrite-refs";
import type { TokenValue } from "../src/core/types";

const DEMO = path.resolve(__dirname, "../examples/demo/design-system");

describe("rewriteValue", () => {
  const r = new Map([["old.token", "new.token"]]);

  const cases: Array<[string, TokenValue, TokenValue]> = [
    [
      "alias",
      { type: "alias", token: "old.token" },
      { type: "alias", token: "new.token" },
    ],
    [
      "derived base + mix + autoContrast",
      {
        type: "derived",
        base: { kind: "token", token: "old.token" },
        ops: [
          { op: "mix", with: "old.token", weight: 0.5 },
          { op: "autoContrast", light: "old.token", dark: "old.token" },
        ],
      },
      {
        type: "derived",
        base: { kind: "token", token: "new.token" },
        ops: [
          { op: "mix", with: "new.token", weight: 0.5 },
          { op: "autoContrast", light: "new.token", dark: "new.token" },
        ],
      },
    ],
    [
      "expression formula",
      { type: "expression", formula: "old.token * 2 + old.token" },
      { type: "expression", formula: "new.token * 2 + new.token" },
    ],
    [
      "composite slots (layered)",
      {
        type: "composite",
        layers: [
          { color: { type: "alias", token: "old.token" } },
          { color: { type: "raw", value: "#fff" } },
        ],
      },
      {
        type: "composite",
        layers: [
          { color: { type: "alias", token: "new.token" } },
          { color: { type: "raw", value: "#fff" } },
        ],
      },
    ],
    [
      "raw untouched",
      { type: "raw", value: "old.token" },
      { type: "raw", value: "old.token" },
    ],
  ];

  for (const [name, input, expected] of cases) {
    it(name, () => {
      expect(rewriteValue(input, r)).toEqual(expected);
    });
  }

  it("does not rewrite partial identifier matches in formulas", () => {
    const v: TokenValue = {
      type: "expression",
      formula: "old.tokens + old.token",
    };
    expect(rewriteValue(v, r)).toEqual({
      type: "expression",
      formula: "old.tokens + new.token",
    });
  });
});

describe("FileStore rename cascade (on demo fixture)", () => {
  let dir: string;
  let store: FileStore;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "tv-test-"));
    cpSync(DEMO, dir, { recursive: true });
    store = await FileStore.open(dir);
  });

  afterEach(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const readCollection = (name: string) =>
    JSON.parse(readFileSync(path.join(dir, "collections", `${name}.json`), "utf8"));

  it("renaming a hand token rewrites its derived reference", async () => {
    await store.renameToken({ name: "brand.accent", newName: "brand.primary" });
    const core = readCollection("core");
    const hover = core.tokens.find((t: { name: string }) => t.name === "brand.hover");
    expect(hover.values.default.$derive.base.token).toBe("brand.primary");
    expect(
      core.tokens.some((t: { name: string }) => t.name === "brand.primary")
    ).toBe(true);
  });

  it("rename cascades ACROSS files into aliases and surfaces config", async () => {
    // Point semantic's focus-ring alias AND the brand surface base at a
    // SOURCE token in core, then rename it: the semantic FILE must be
    // rewritten on disk. (Generated names like color.blue.500 are not
    // renameable — their identity comes from the generator config.)
    await store.updateToken({
      name: "focus-ring",
      values: {
        light: { type: "alias", token: "brand.accent" },
        dark: { type: "alias", token: "brand.accent" },
      },
    });
    const semanticBefore = readCollection("semantic");
    const surfaces = semanticBefore.surfacesConfig;
    surfaces.surfaces[1].baseByMode.light = {
      kind: "alias",
      token: "brand.accent",
    };
    await store.updateSurfacesConfig({
      collection: "semantic",
      config: surfaces,
    });

    await store.renameToken({ name: "brand.accent", newName: "brand.primary" });

    const semantic = readCollection("semantic");
    expect(semantic.tokens[0].values.light).toBe("{brand.primary}");
    const brand = semantic.surfacesConfig.surfaces.find(
      (s: { name: string }) => s.name === "surface.brand"
    );
    expect(brand.baseByMode.light.token).toBe("brand.primary");
  });

  it("rename cascades into expression formulas", async () => {
    await store.renameToken({ name: "container", newName: "layout.container" });
    const core = readCollection("core");
    const narrow = core.tokens.find(
      (t: { name: string }) => t.name === "container.narrow"
    );
    expect(narrow.values.default.$expr).toBe("layout.container * 0.75");
  });

  it("rejects renaming onto an existing name", async () => {
    await expect(
      store.renameToken({ name: "container", newName: "brand.accent" })
    ).rejects.toThrow(/already exists/);
  });

  it("renameGroup renames source tokens under a prefix and rewrites refs", async () => {
    await store.renameGroup({
      collection: "core",
      oldPrefix: "brand",
      newPrefix: "accent",
    });
    const core = readCollection("core");
    const names = core.tokens.map((t: { name: string }) => t.name);
    expect(names).toContain("accent.accent");
    expect(names).toContain("accent.hover");
    const hover = core.tokens.find(
      (t: { name: string }) => t.name === "accent.hover"
    );
    expect(hover.values.default.$derive.base.token).toBe("accent.accent");
  });

  it("mode rename moves value keys and surfaces per-mode maps", async () => {
    await store.renameMode({
      collection: "semantic",
      oldName: "dark",
      newName: "night",
    });
    const semantic = readCollection("semantic");
    expect(semantic.modes).toEqual(["light", "night"]);
    expect(semantic.tokens[0].values.night).toBe("{color.blue.300}");
    expect(
      semantic.surfacesConfig.surfaces[0].baseByMode.night.value
    ).toBe("#0a0a0a");
  });

  it("removeMode drops the mode from values and surfaces maps", async () => {
    await store.removeMode({ collection: "semantic", mode: "dark" });
    const semantic = readCollection("semantic");
    expect(semantic.modes).toEqual(["light"]);
    expect(semantic.tokens[0].values.dark).toBeUndefined();
    expect(
      semantic.surfacesConfig.surfaces[0].baseByMode.dark
    ).toBeUndefined();
  });

  it("removeMode protects default and the last mode", async () => {
    await expect(
      store.removeMode({ collection: "core", mode: "default" })
    ).rejects.toThrow(/cannot be removed/);
    await store.removeMode({ collection: "semantic", mode: "dark" });
    await expect(
      store.removeMode({ collection: "semantic", mode: "light" })
    ).rejects.toThrow(/at least one mode/);
  });

  it("renameCollection renames the file and the system entry", async () => {
    await store.renameCollection({ name: "semantic", newName: "theme" });
    const system = JSON.parse(
      readFileSync(path.join(dir, "system.json"), "utf8")
    );
    expect(system.collections).toEqual(["core", "theme"]);
    expect(readCollection("theme").name).toBe("theme");
    expect(() => readCollection("semantic")).toThrow();
  });

  it("renaming a color family cascades refs to its generated tokens", async () => {
    // brand.accent aliases color.blue.600 (generated); semantic's brand
    // surface bases point at color.blue.600/400. Rename the family.
    const core = store
      .snapshot()
      .collections.find((c) => c.name === "core")!;
    const gen = core.generators!.find((g) => g.type === "color")!;
    const config = JSON.parse(JSON.stringify(gen.config)) as typeof gen.config;
    if (config.type !== "color") throw new Error("wrong generator");
    config.colorScaleConfig.families[0].name = "azure";
    await store.updateGeneratorConfig({
      collection: "core",
      generatorId: gen.id,
      config,
    });

    const coreFile = readCollection("core");
    const accent = coreFile.tokens.find(
      (t: { name: string }) => t.name === "brand.accent"
    );
    expect(accent.values.default).toBe("{color.azure.600}");
    const semantic = readCollection("semantic");
    const brand = semantic.surfacesConfig.surfaces.find(
      (s: { name: string }) => s.name === "surface.brand"
    );
    expect(brand.baseByMode.light.token).toBe("color.azure.600");
    expect(brand.baseByMode.dark.token).toBe("color.azure.400");
    expect(store.findDanglingRefs()).toEqual([]);
  });

  it("changing a generator's groupPrefix cascades refs", async () => {
    const core = store
      .snapshot()
      .collections.find((c) => c.name === "core")!;
    const gen = core.generators!.find((g) => g.type === "color")!;
    await store.updateGeneratorConfig({
      collection: "core",
      generatorId: gen.id,
      config: gen.config,
      groupPrefix: "palette",
    });
    const coreFile = readCollection("core");
    const accent = coreFile.tokens.find(
      (t: { name: string }) => t.name === "brand.accent"
    );
    expect(accent.values.default).toBe("{palette.blue.600}");
    expect(store.findDanglingRefs()).toEqual([]);
  });

  it("updateToken writes the new value shape to disk", async () => {
    await store.updateToken({
      name: "brand.muted",
      values: { default: { type: "tailwind", color: "zinc-400" } },
    });
    const core = readCollection("core");
    const muted = core.tokens.find((t: { name: string }) => t.name === "brand.muted");
    expect(muted.values.default).toEqual({ $tw: "zinc-400" });
  });
});
