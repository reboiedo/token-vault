/**
 * Cross-surface references: a surface base may alias another surface's
 * materialized level token, and a level anchor may alias another
 * surface's materialized base. One resolver pass over source + scale
 * tokens can't see those — recompute must iterate materialization to a
 * fixed point (the Convex store converged across saves; the file store
 * has to converge within one recompute).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileStore } from "../src/store/file-store";

const DEMO = path.resolve(__dirname, "../examples/demo/design-system");

describe("surface materialization fixed point", () => {
  let dir: string;
  let store: FileStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "tv-test-"));
    cpSync(DEMO, dir, { recursive: true });

    // Extend the demo surfacesConfig with both cross-surface patterns:
    //  - `panel`: base aliases `hover` (bg's bare materialized level)
    //  - `ring` level on bg: surface-mix anchored on `panel`'s base, mix 1
    const file = path.join(dir, "collections", "semantic.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    doc.surfacesConfig.levels.push({
      id: "l-ring",
      name: "ring",
      rule: {
        kind: "surface-mix",
        onLight: { anchor: { kind: "alias", token: "panel" }, mix: 1 },
        onDark: { anchor: { kind: "alias", token: "panel" }, mix: 1 },
      },
    });
    doc.surfacesConfig.surfaces.push({
      id: "s-panel",
      name: "panel",
      baseByMode: {
        light: { kind: "alias", token: "hover" },
      },
      materializeBase: true,
    });
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  });

  afterEach(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const tokensByName = () => {
    const semantic = store
      .snapshot()
      .collections.find((c) => c.name === "semantic")!;
    return new Map(semantic.tokens.map((t) => [t.name, t]));
  };

  it("materializes a surface whose base aliases another surface's level", async () => {
    store = await FileStore.open(dir);
    const tokens = tokensByName();

    const hover = tokens.get("hover");
    const panel = tokens.get("panel");
    expect(hover).toBeDefined();
    expect(panel).toBeDefined();
    // panel = hover's resolved color, per mode (dark inherits light's alias).
    expect(panel!.values.light).toEqual(hover!.values.light);
  });

  it("resolves a level anchored on another surface's materialized base", async () => {
    store = await FileStore.open(dir);
    const tokens = tokensByName();

    const panel = tokens.get("panel");
    const ring = tokens.get("ring");
    expect(ring).toBeDefined();
    // mix 1 toward the panel anchor = exactly panel's base color — and
    // NOT the ink fallback a null anchor would bake.
    expect(ring!.values.light).toEqual(panel!.values.light);
  });

  it("check() reports no dangling refs for cross-surface aliases", async () => {
    store = await FileStore.open(dir);
    expect(store.findDanglingRefs()).toEqual([]);
  });
});
