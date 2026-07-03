/**
 * `token-vault build` — bake the recomputed snapshot to DTCG output:
 *   dist/tokens.json          (single layout)  or  dist/<collection>.json
 *   dist/$metadata.json
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { SystemSnapshot } from "../core/types";
import {
  generateDtcgExport,
  normalizeCollectionName,
  serializeMetadata,
  serializeTokens,
} from "../core/dtcg-export";

export async function writeDtcgBuild(
  snapshot: SystemSnapshot,
  outDir: string,
  generatedAt: string = new Date().toISOString()
): Promise<string[]> {
  const { system, collections } = snapshot;
  const layout = system.exportLayout ?? "single";
  const result = generateDtcgExport(
    system,
    collections,
    "default",
    layout,
    generatedAt
  );

  await fs.mkdir(outDir, { recursive: true });
  const written: string[] = [];
  const write = async (name: string, content: string) => {
    const file = path.join(outDir, name);
    await fs.writeFile(file, `${content}\n`, "utf8");
    written.push(path.relative(process.cwd(), file));
  };

  if (layout === "per-collection" && result.tokenFiles) {
    for (const [collection, tokens] of Object.entries(result.tokenFiles)) {
      await write(
        `${normalizeCollectionName(collection)}.json`,
        serializeTokens(tokens as Record<string, unknown>)
      );
    }
  } else {
    await write("tokens.json", serializeTokens(result.tokens));
  }
  await write("$metadata.json", serializeMetadata(result.metadata));
  return written;
}
