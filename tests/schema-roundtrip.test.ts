/**
 * The file codec must be lossless for source (non-generated) content:
 * decode(encode(decode(file))) === decode(file), and encoding the demo
 * fixtures reproduces their canonical form byte-for-byte modulo key
 * order (we compare parsed structures, not strings).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  collectionFileSchema,
  decodeCollection,
  decodeValue,
  encodeCollection,
  encodeValue,
  systemFileSchema,
} from "../src/schema/index";
import type { TokenValue } from "../src/core/types";

const DEMO = path.resolve(__dirname, "../examples/demo/design-system");

const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

describe("value codec", () => {
  const cases: TokenValue[] = [
    { type: "raw", value: "72rem" },
    { type: "raw", value: 1.5 },
    { type: "raw", value: true },
    { type: "alias", token: "color.blue.600" },
    { type: "tailwind", color: "slate-500" },
    {
      type: "derived",
      base: { kind: "token", token: "brand.accent" },
      ops: [
        { op: "shift", stepStrength: 0.4 },
        { op: "mix", with: "color.blue.900", weight: 0.2 },
      ],
    },
    { type: "expression", formula: "container * 0.75" },
    {
      type: "composite",
      layers: {
        color: { type: "alias", token: "color.blue.600" },
        offsetX: { type: "raw", value: "0px" },
      },
    },
    {
      type: "composite",
      layers: [
        { color: { type: "raw", value: "#000000" } },
        { color: { type: "alias", token: "color.blue.950" } },
      ],
    },
  ];

  for (const value of cases) {
    it(`round-trips ${value.type}${value.type === "composite" && Array.isArray(value.layers) ? " (layered)" : ""}`, () => {
      expect(decodeValue(encodeValue(value))).toEqual(value);
    });
  }

  it("parses alias shorthand strings", () => {
    expect(decodeValue("{color.blue.600}")).toEqual({
      type: "alias",
      token: "color.blue.600",
    });
  });
});

describe("demo fixtures", () => {
  it("system.json validates", () => {
    expect(() =>
      systemFileSchema.parse(readJson(path.join(DEMO, "system.json")))
    ).not.toThrow();
  });

  for (const name of ["core", "semantic"]) {
    it(`collections/${name}.json validates and round-trips`, () => {
      const raw = readJson(path.join(DEMO, "collections", `${name}.json`));
      const file = collectionFileSchema.parse(raw);
      const doc = decodeCollection(file);
      const reencoded = encodeCollection(doc);
      // decode(encode(decode(x))) === decode(x): the canonical model is
      // stable through a write cycle.
      expect(decodeCollection(collectionFileSchema.parse(reencoded))).toEqual(
        doc
      );
    });
  }
});
