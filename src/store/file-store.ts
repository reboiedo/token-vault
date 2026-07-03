/**
 * FileStore — the local "backend".
 *
 * Loads a `design-system/` folder into the canonical in-memory model,
 * recomputes every `generated` token (generator scales + surfaces
 * materialization), and watches the folder so external edits (a human
 * in their editor, an MCP agent, git checkout) flow into the running
 * snapshot. Writes are atomic (tmp + rename) and self-echoes are
 * suppressed by content hash.
 *
 * Mutations land in F2 — for now the store is load/recompute/watch.
 */

import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import {
  collectionFileSchema,
  decodeCollection,
  decodeSystem,
  encodeCollection,
  encodeSystem,
  systemFileSchema,
} from "../schema/index";
import type {
  CollectionDoc,
  SystemDoc,
  SystemSnapshot,
  TokenDoc,
  TokenValue,
} from "../core/types";
import { computeGeneratedForCollection } from "../core/generators";
import { resolveDerivationToHex } from "../core/derivation";
import { getTailwindHex } from "../core/tailwind-colors";
import {
  generateSurfaceTokens,
  makeResolveScaleStep,
  type AliasResolvable,
  type SurfacesConfig,
} from "../core/surfaces-utils";

export interface LoadIssue {
  file: string;
  message: string;
}

export class DesignSystemError extends Error {
  constructor(public issues: LoadIssue[]) {
    super(
      `Invalid design system:\n${issues
        .map((i) => `  ${i.file}: ${i.message}`)
        .join("\n")}`
    );
  }
}

export class FileStore extends EventEmitter {
  private system!: SystemDoc;
  private collections: CollectionDoc[] = [];
  private rev = 0;
  private watcher: FSWatcher | null = null;
  /** Content hashes of our own writes, keyed by absolute path. */
  private ownWrites = new Map<string, string>();
  private reloadTimer: NodeJS.Timeout | null = null;

  constructor(readonly dir: string) {
    super();
  }

  // ==========================================================================
  // LOAD
  // ==========================================================================

  static async open(dir: string): Promise<FileStore> {
    const store = new FileStore(dir);
    await store.load();
    return store;
  }

  private systemPath(): string {
    return path.join(this.dir, "system.json");
  }

  private collectionPath(name: string): string {
    return path.join(this.dir, "collections", `${name}.json`);
  }

  async load(): Promise<void> {
    const issues: LoadIssue[] = [];

    const readJson = async (file: string): Promise<unknown | null> => {
      try {
        return JSON.parse(await fs.readFile(file, "utf8"));
      } catch (err) {
        issues.push({
          file: path.relative(this.dir, file),
          message: err instanceof SyntaxError ? `JSON parse error: ${err.message}` : String(err),
        });
        return null;
      }
    };

    const systemRaw = await readJson(this.systemPath());
    if (systemRaw === null) throw new DesignSystemError(issues);
    const systemParsed = systemFileSchema.safeParse(systemRaw);
    if (!systemParsed.success) {
      throw new DesignSystemError([
        ...issues,
        ...systemParsed.error.issues.map((i) => ({
          file: "system.json",
          message: `${i.path.join(".")}: ${i.message}`,
        })),
      ]);
    }
    const system = decodeSystem(systemParsed.data);

    const collections: CollectionDoc[] = [];
    for (const name of system.collections) {
      const file = this.collectionPath(name);
      const raw = await readJson(file);
      if (raw === null) continue;
      const parsed = collectionFileSchema.safeParse(raw);
      if (!parsed.success) {
        issues.push(
          ...parsed.error.issues.map((i) => ({
            file: path.relative(this.dir, file),
            message: `${i.path.join(".")}: ${i.message}`,
          }))
        );
        continue;
      }
      if (parsed.data.name !== name) {
        issues.push({
          file: path.relative(this.dir, file),
          message: `collection name "${parsed.data.name}" does not match filename "${name}"`,
        });
        continue;
      }
      collections.push(decodeCollection(parsed.data));
    }

    if (issues.length) throw new DesignSystemError(issues);

    // Duplicate-name check across the whole system (names are identity).
    const seen = new Map<string, string>();
    for (const c of collections) {
      for (const t of c.tokens) {
        const prev = seen.get(t.name);
        if (prev) {
          issues.push({
            file: `collections/${c.name}.json`,
            message: `duplicate token name "${t.name}" (also in ${prev})`,
          });
        } else {
          seen.set(t.name, `collections/${c.name}.json`);
        }
      }
    }
    if (issues.length) throw new DesignSystemError(issues);

    this.system = system;
    this.collections = this.recompute(system, collections);
    this.rev++;
    this.emit("change", this.snapshot());
  }

  // ==========================================================================
  // RECOMPUTE — generators + surfaces materialization
  // ==========================================================================

  private recompute(
    system: SystemDoc,
    sourceCollections: CollectionDoc[]
  ): CollectionDoc[] {
    // 1. Generator tokens (color scales, fluid spacing/typography).
    const withGenerated = sourceCollections.map((c) => {
      const source = c.tokens.filter((t) => !t.generated);
      const generated = computeGeneratedForCollection(c, system);
      return { ...c, tokens: [...generated, ...source] };
    });

    // 2. Global name → token index for reference resolution.
    const byName = new Map<string, { token: TokenDoc; modes: string[] }>();
    for (const c of withGenerated) {
      for (const t of c.tokens) byName.set(t.name, { token: t, modes: c.modes });
    }

    // Resolve a token ref to a raw string value for a mode (color hex,
    // dimension, …), walking aliases / derivations / tailwind refs.
    const resolveRaw = (
      ref: string,
      mode: string | undefined,
      visiting: Set<string>
    ): string | null => {
      if (visiting.has(ref)) return null;
      visiting.add(ref);
      const entry = byName.get(ref);
      if (!entry) return null;
      const { token } = entry;
      const value: TokenValue | undefined =
        (mode ? token.values[mode] : undefined) ??
        token.values["default"] ??
        Object.values(token.values)[0];
      if (!value) return null;
      switch (value.type) {
        case "raw":
          return String(value.value);
        case "alias":
          return resolveRaw(value.token, mode, visiting);
        case "tailwind":
          return getTailwindHex(value.color);
        case "derived":
          try {
            return resolveDerivationToHex(value.base, value.ops, (r) =>
              resolveRaw(r, mode, visiting)
            );
          } catch {
            return null;
          }
        default:
          return null; // expression/composite: not color-resolvable
      }
    };

    // 3. Surfaces materialization per themes collection.
    return withGenerated.map((c) => {
      const surfaces = c.surfacesConfig as SurfacesConfig | undefined;
      if (!surfaces || surfaces.surfaces.length === 0) return c;

      const aliasOptions: AliasResolvable[] = [...byName.entries()].map(
        ([name]) => {
          const resolvedByMode: Record<string, string> = {};
          for (const mode of c.modes) {
            const hex = resolveRaw(name, mode, new Set());
            if (hex) resolvedByMode[mode] = hex;
          }
          return {
            name,
            resolvedValue: resolveRaw(name, undefined, new Set()) ?? undefined,
            resolvedByMode,
          };
        }
      );

      const resolveBaseHex = (ref: string, mode?: string) =>
        resolveRaw(ref, mode, new Set());
      const resolveScaleStep = makeResolveScaleStep(aliasOptions);

      const surfaceTokens = generateSurfaceTokens(
        surfaces,
        c.modes,
        resolveBaseHex,
        { resolveScaleStep }
      );

      const materialized: TokenDoc[] = surfaceTokens.map((st) => ({
        name: st.name,
        type: "color",
        generated: true,
        values: Object.fromEntries(
          Object.entries(st.values).map(([mode, v]) => [
            mode,
            { type: "raw", value: v.value } satisfies TokenValue,
          ])
        ),
      }));

      // Materialized surface tokens replace any stale same-name entries.
      const materializedNames = new Set(materialized.map((t) => t.name));
      return {
        ...c,
        tokens: [
          ...c.tokens.filter((t) => !materializedNames.has(t.name)),
          ...materialized,
        ],
      };
    });
  }

  // ==========================================================================
  // SNAPSHOT
  // ==========================================================================

  snapshot(): SystemSnapshot {
    return { system: this.system, collections: this.collections, rev: this.rev };
  }

  // ==========================================================================
  // WRITE (atomic, echo-suppressed) — used by F2 mutations and `init`.
  // ==========================================================================

  private async writeFile(file: string, content: string): Promise<void> {
    const hash = createHash("sha256").update(content).digest("hex");
    this.ownWrites.set(file, hash);
    const tmp = `${file}.tmp-${process.pid}`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(tmp, content, "utf8");
    await fs.rename(tmp, file);
  }

  async persist(): Promise<void> {
    const stable = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
    await this.writeFile(this.systemPath(), stable(encodeSystem(this.system)));
    for (const c of this.collections) {
      await this.writeFile(
        this.collectionPath(c.name),
        stable(encodeCollection(c))
      );
    }
  }

  // ==========================================================================
  // WATCH
  // ==========================================================================

  async startWatching(): Promise<void> {
    if (this.watcher) return;
    this.watcher = chokidar.watch(
      [this.systemPath(), path.join(this.dir, "collections")],
      { ignoreInitial: true }
    );
    const onFsEvent = async (file: string) => {
      // Ignore echoes of our own atomic writes.
      try {
        const content = await fs.readFile(file, "utf8");
        const hash = createHash("sha256").update(content).digest("hex");
        if (this.ownWrites.get(file) === hash) return;
      } catch {
        // Deleted/renamed — fall through to reload.
      }
      this.scheduleReload();
    };
    this.watcher.on("add", onFsEvent);
    this.watcher.on("change", onFsEvent);
    this.watcher.on("unlink", () => this.scheduleReload());
  }

  private scheduleReload(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      this.load().catch((err) => this.emit("error", err));
    }, 80);
  }

  async close(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
  }
}
