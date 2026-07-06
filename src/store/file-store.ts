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
import type { GeneratorDef } from "../core/types";
import { computeGeneratedForCollection } from "../core/generators";
import { buildResolver } from "../core/resolve";
import {
  generateSurfaceTokens,
  makeResolveScaleStep,
  type SurfacesConfig,
} from "../core/surfaces-utils";
import {
  collectSurfacesRefs,
  collectValueRefs,
  rewriteRefs,
} from "./rewrite-refs";

export interface FigmaIdsFile {
  collections: Record<string, { figmaId?: string; figmaFluidId?: string }>;
  tokens: Record<string, { figmaId?: string; figmaTextStyleId?: string }>;
}

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
  /** Source documents as decoded from disk (no generated tokens). */
  private source: CollectionDoc[] = [];
  /** Recomputed view: source + generated tokens, what consumers see. */
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
    this.source = collections;
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

    // 2. Global resolver over source + generated tokens.
    const resolver = buildResolver(withGenerated);

    // 3. Surfaces materialization per themes collection.
    return withGenerated.map((c) => {
      const surfaces = c.surfacesConfig as SurfacesConfig | undefined;
      if (!surfaces || surfaces.surfaces.length === 0) return c;

      const aliasOptions = resolver.aliasOptions(c.modes);
      const resolveBaseHex = (ref: string, mode?: string) =>
        resolver.resolveRaw(ref, mode);
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

  /**
   * Scan every source reference against the recomputed view's names
   * (source + generated). Dangling refs = corruption risk — surfaced by
   * `token-vault check` with a non-zero exit for CI.
   */
  findDanglingRefs(): Array<{ owner: string; ref: string }> {
    const known = new Set<string>();
    for (const c of this.collections)
      for (const t of c.tokens) known.add(t.name);

    const out: Array<{ owner: string; ref: string }> = [];
    for (const c of this.source) {
      for (const t of c.tokens) {
        for (const value of Object.values(t.values)) {
          for (const ref of collectValueRefs(value)) {
            if (!known.has(ref)) out.push({ owner: t.name, ref });
          }
        }
      }
      const surfaces = c.surfacesConfig as SurfacesConfig | undefined;
      if (surfaces) {
        for (const ref of collectSurfacesRefs(surfaces)) {
          if (!known.has(ref)) {
            out.push({ owner: `${c.name} surfacesConfig`, ref });
          }
        }
      }
    }
    return out;
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

  private static stableJson(v: unknown): string {
    return `${JSON.stringify(v, null, 2)}\n`;
  }

  async persist(): Promise<void> {
    await this.writeFile(
      this.systemPath(),
      FileStore.stableJson(encodeSystem(this.system))
    );
    for (const c of this.source) {
      await this.writeFile(
        this.collectionPath(c.name),
        FileStore.stableJson(encodeCollection(c))
      );
    }
  }

  // ==========================================================================
  // MUTATIONS — all funnel through `commit`, which recomputes the view,
  // persists only touched files, bumps rev and notifies subscribers.
  // ==========================================================================

  private findSource(collection: string): CollectionDoc {
    const c = this.source.find((c) => c.name === collection);
    if (!c) throw new Error(`Unknown collection "${collection}"`);
    return c;
  }

  private replaceSource(next: CollectionDoc): void {
    this.source = this.source.map((c) => (c.name === next.name ? next : c));
  }

  private async commit(
    touched: Iterable<string>,
    opts: { system?: boolean } = {}
  ): Promise<void> {
    this.collections = this.recompute(this.system, this.source);
    this.rev++;
    if (opts.system) {
      await this.writeFile(
        this.systemPath(),
        FileStore.stableJson(encodeSystem(this.system))
      );
    }
    for (const name of new Set(touched)) {
      const c = this.source.find((c) => c.name === name);
      if (c) {
        await this.writeFile(
          this.collectionPath(name),
          FileStore.stableJson(encodeCollection(c))
        );
      }
    }
    this.emit("change", this.snapshot());
  }

  /** Every source token name in the system (names are identity). */
  private allSourceNames(): Set<string> {
    const names = new Set<string>();
    for (const c of this.source) for (const t of c.tokens) names.add(t.name);
    return names;
  }

  private assertNameFree(name: string): void {
    if (this.allSourceNames().has(name)) {
      throw new Error(`Token "${name}" already exists`);
    }
  }

  async createToken(p: {
    collection: string;
    token: TokenDoc;
    index?: number;
  }): Promise<void> {
    this.assertNameFree(p.token.name);
    const c = this.findSource(p.collection);
    const tokens = [...c.tokens];
    tokens.splice(p.index ?? tokens.length, 0, p.token);
    this.replaceSource({ ...c, tokens });
    await this.commit([p.collection]);
  }

  async updateToken(p: {
    name: string;
    values?: Record<string, TokenValue>;
    type?: TokenDoc["type"];
    description?: string;
  }): Promise<void> {
    const c = this.source.find((c) => c.tokens.some((t) => t.name === p.name));
    if (!c) throw new Error(`Unknown token "${p.name}"`);
    this.replaceSource({
      ...c,
      tokens: c.tokens.map((t) =>
        t.name === p.name
          ? {
              ...t,
              ...(p.values ? { values: p.values } : {}),
              ...(p.type !== undefined ? { type: p.type } : {}),
              ...(p.description !== undefined
                ? { description: p.description }
                : {}),
            }
          : t
      ),
    });
    await this.commit([c.name]);
  }

  async removeToken(p: { name: string }): Promise<void> {
    const c = this.source.find((c) => c.tokens.some((t) => t.name === p.name));
    if (!c) throw new Error(`Unknown token "${p.name}"`);
    this.replaceSource({
      ...c,
      tokens: c.tokens.filter((t) => t.name !== p.name),
    });
    await this.commit([c.name]);
  }

  /**
   * Rename a token and cascade the rename through every reference in
   * every collection (values + surfaces configs).
   */
  async renameToken(p: { name: string; newName: string }): Promise<void> {
    if (p.name === p.newName) return;
    this.assertNameFree(p.newName);
    const owner = this.source.find((c) =>
      c.tokens.some((t) => t.name === p.name)
    );
    if (!owner) throw new Error(`Unknown token "${p.name}"`);

    const renames = new Map([[p.name, p.newName]]);
    const { collections, touched } = rewriteRefs(this.source, renames);
    this.source = collections.map((c) =>
      c.name === owner.name
        ? {
            ...c,
            tokens: c.tokens.map((t) =>
              t.name === p.name ? { ...t, name: p.newName } : t
            ),
          }
        : c
    );
    touched.add(owner.name);
    await this.patchFigmaTokenRenames(renames);
    await this.commit(touched);
  }

  /** Rename a dotted prefix ("brand" → "core.brand") across a collection. */
  async renameGroup(p: {
    collection: string;
    oldPrefix: string;
    newPrefix: string;
  }): Promise<void> {
    if (p.oldPrefix === p.newPrefix) return;
    const c = this.findSource(p.collection);
    const renames = new Map<string, string>();
    for (const t of c.tokens) {
      if (t.name === p.oldPrefix || t.name.startsWith(`${p.oldPrefix}.`)) {
        renames.set(t.name, p.newPrefix + t.name.slice(p.oldPrefix.length));
      }
    }
    if (renames.size === 0) return;
    for (const newName of renames.values()) this.assertNameFree(newName);

    const { collections, touched } = rewriteRefs(this.source, renames);
    this.source = collections.map((col) =>
      col.name === p.collection
        ? {
            ...col,
            tokens: col.tokens.map((t) =>
              renames.has(t.name) ? { ...t, name: renames.get(t.name)! } : t
            ),
            ...(col.groupOrder
              ? {
                  groupOrder: col.groupOrder.map((g) =>
                    g === p.oldPrefix ? p.newPrefix : g
                  ),
                }
              : {}),
          }
        : col
    );
    touched.add(p.collection);
    await this.patchFigmaTokenRenames(renames);
    await this.commit(touched);
  }

  /** Reorder a collection's source tokens to the given name order. */
  async reorderTokens(p: {
    collection: string;
    names: string[];
  }): Promise<void> {
    const c = this.findSource(p.collection);
    const byName = new Map(c.tokens.map((t) => [t.name, t]));
    const ordered: TokenDoc[] = [];
    for (const name of p.names) {
      const t = byName.get(name);
      if (t) {
        ordered.push(t);
        byName.delete(name);
      }
    }
    ordered.push(...byName.values()); // anything unlisted keeps tail order
    this.replaceSource({ ...c, tokens: ordered });
    await this.commit([p.collection]);
  }

  async addMode(p: { collection: string; mode: string }): Promise<void> {
    const c = this.findSource(p.collection);
    if (c.modes.includes(p.mode)) throw new Error(`Mode "${p.mode}" exists`);
    this.replaceSource({ ...c, modes: [...c.modes, p.mode] });
    await this.commit([p.collection]);
  }

  async renameMode(p: {
    collection: string;
    oldName: string;
    newName: string;
  }): Promise<void> {
    const c = this.findSource(p.collection);
    if (!c.modes.includes(p.oldName))
      throw new Error(`Unknown mode "${p.oldName}"`);
    if (c.modes.includes(p.newName))
      throw new Error(`Mode "${p.newName}" exists`);
    const renameKey = <V,>(rec: Record<string, V>): Record<string, V> =>
      Object.fromEntries(
        Object.entries(rec).map(([k, v]) => [
          k === p.oldName ? p.newName : k,
          v,
        ])
      );
    const surfaces = c.surfacesConfig as SurfacesConfig | undefined;
    this.replaceSource({
      ...c,
      modes: c.modes.map((m) => (m === p.oldName ? p.newName : m)),
      tokens: c.tokens.map((t) => ({ ...t, values: renameKey(t.values) })),
      ...(surfaces
        ? {
            surfacesConfig: {
              ...surfaces,
              surfaces: surfaces.surfaces.map((s) => ({
                ...s,
                baseByMode: renameKey(s.baseByMode),
                ...(s.fgByMode ? { fgByMode: renameKey(s.fgByMode) } : {}),
              })),
            },
          }
        : {}),
    });
    await this.commit([p.collection]);
  }

  /**
   * Remove a mode: drops the mode key from every token's values and
   * from the surfaces config's per-mode maps. "default" and the last
   * remaining mode are protected (mirrors the cloud's EditThemesDialog).
   */
  async removeMode(p: { collection: string; mode: string }): Promise<void> {
    const c = this.findSource(p.collection);
    if (!c.modes.includes(p.mode)) throw new Error(`Unknown mode "${p.mode}"`);
    if (p.mode === "default") throw new Error(`The "default" mode cannot be removed`);
    if (c.modes.length <= 1) throw new Error("A collection needs at least one mode");
    const dropKey = <V,>(rec: Record<string, V>): Record<string, V> =>
      Object.fromEntries(Object.entries(rec).filter(([k]) => k !== p.mode));
    const surfaces = c.surfacesConfig as SurfacesConfig | undefined;
    this.replaceSource({
      ...c,
      modes: c.modes.filter((m) => m !== p.mode),
      tokens: c.tokens.map((t) => ({ ...t, values: dropKey(t.values) })),
      ...(surfaces
        ? {
            surfacesConfig: {
              ...surfaces,
              surfaces: surfaces.surfaces.map((s) => ({
                ...s,
                baseByMode: dropKey(s.baseByMode),
                ...(s.fgByMode ? { fgByMode: dropKey(s.fgByMode) } : {}),
              })),
            },
          }
        : {}),
    });
    await this.commit([p.collection]);
  }

  async renameCollection(p: { name: string; newName: string }): Promise<void> {
    if (p.name === p.newName) return;
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(p.newName)) {
      throw new Error(
        `Collection name "${p.newName}" must be a simple identifier (it becomes the filename)`
      );
    }
    const c = this.findSource(p.name);
    if (this.source.some((col) => col.name === p.newName)) {
      throw new Error(`Collection "${p.newName}" already exists`);
    }
    this.source = this.source.map((col) =>
      col.name === p.name ? { ...c, name: p.newName } : col
    );
    this.system = {
      ...this.system,
      collections: this.system.collections.map((n) =>
        n === p.name ? p.newName : n
      ),
    };
    await fs.rm(this.collectionPath(p.name), { force: true });
    try {
      await fs.access(this.figmaIdsPath());
      const ids = await this.readFigmaIds();
      if (ids.collections[p.name]) {
        ids.collections[p.newName] = ids.collections[p.name];
        delete ids.collections[p.name];
        await this.writeFigmaIds(ids);
      }
    } catch {
      // no sidecar - nothing to patch
    }
    await this.commit([p.newName], { system: true });
  }

  async reorderModes(p: { collection: string; modes: string[] }): Promise<void> {
    const c = this.findSource(p.collection);
    if ([...p.modes].sort().join() !== [...c.modes].sort().join()) {
      throw new Error("Reordered modes must match the existing set");
    }
    this.replaceSource({ ...c, modes: p.modes });
    await this.commit([p.collection]);
  }

  async updateGroupOrder(p: {
    collection: string;
    groupOrder: string[];
  }): Promise<void> {
    const c = this.findSource(p.collection);
    this.replaceSource({ ...c, groupOrder: p.groupOrder });
    await this.commit([p.collection]);
  }

  async addGenerator(p: {
    collection: string;
    generator: GeneratorDef;
  }): Promise<void> {
    const c = this.findSource(p.collection);
    this.replaceSource({
      ...c,
      generators: [...(c.generators ?? []), p.generator],
    });
    await this.commit([p.collection]);
  }

  async updateGeneratorConfig(p: {
    collection: string;
    generatorId: string;
    config: GeneratorDef["config"];
    groupPrefix?: string;
  }): Promise<void> {
    const c = this.findSource(p.collection);
    if (!c.generators?.some((g) => g.id === p.generatorId)) {
      throw new Error(`Unknown generator "${p.generatorId}"`);
    }
    const next: CollectionDoc = {
      ...c,
      generators: c.generators.map((g) =>
        g.id === p.generatorId
          ? {
              ...g,
              config: p.config,
              ...(p.groupPrefix !== undefined
                ? { groupPrefix: p.groupPrefix }
                : {}),
            }
          : g
      ),
    };
    this.replaceSource(next);

    // Generated-name cascade: a groupPrefix / color-family / step rename
    // changes the names of generated tokens, and references elsewhere
    // (aliases, surfaces bases, expressions) must follow — generated
    // names are identity like any other. Generation order is
    // deterministic (config order × steps), so when the old and new
    // outputs have the SAME length we can zip them positionally and
    // rewrite every name that changed. Length changes (steps added or
    // removed) have no stable mapping — `token-vault check` flags any
    // refs left dangling.
    const oldNames = computeGeneratedForCollection(c, this.system).map(
      (t) => t.name
    );
    const newNames = computeGeneratedForCollection(next, this.system).map(
      (t) => t.name
    );
    const touched = new Set<string>([p.collection]);
    if (oldNames.length === newNames.length) {
      const renames = new Map<string, string>();
      for (let i = 0; i < oldNames.length; i++) {
        if (oldNames[i] !== newNames[i]) renames.set(oldNames[i], newNames[i]);
      }
      if (renames.size > 0) {
        const rewritten = rewriteRefs(this.source, renames);
        this.source = rewritten.collections;
        for (const name of rewritten.touched) touched.add(name);
        await this.patchFigmaTokenRenames(renames);
      }
    }
    await this.commit(touched);
  }

  async removeGenerator(p: {
    collection: string;
    generatorId: string;
  }): Promise<void> {
    const c = this.findSource(p.collection);
    this.replaceSource({
      ...c,
      generators: (c.generators ?? []).filter((g) => g.id !== p.generatorId),
    });
    await this.commit([p.collection]);
  }

  // ==========================================================================
  // FIGMA SIDECAR — .figma-ids.json maps token/collection NAMES to the
  // Figma Variable / Collection ids the plugin created, so re-syncs
  // update in place instead of duplicating. Names are identity, so every
  // rename (tokens, groups, generated names, collections) patches the
  // sidecar too.
  // ==========================================================================

  private figmaIdsPath(): string {
    return path.join(this.dir, ".figma-ids.json");
  }

  async readFigmaIds(): Promise<FigmaIdsFile> {
    try {
      const raw = JSON.parse(await fs.readFile(this.figmaIdsPath(), "utf8"));
      return {
        collections: raw.collections ?? {},
        tokens: raw.tokens ?? {},
      };
    } catch {
      return { collections: {}, tokens: {} };
    }
  }

  async writeFigmaIds(ids: FigmaIdsFile): Promise<void> {
    await this.writeFile(this.figmaIdsPath(), FileStore.stableJson(ids));
  }

  /** Merge the plugin's post-sync id report into the sidecar. */
  async updateFigmaIds(p: {
    collections?: Array<{ name: string; figmaId?: string; figmaFluidId?: string }>;
    tokens?: Array<{ name: string; figmaId?: string; figmaTextStyleId?: string }>;
  }): Promise<void> {
    const ids = await this.readFigmaIds();
    for (const c of p.collections ?? []) {
      ids.collections[c.name] = {
        ...ids.collections[c.name],
        ...(c.figmaId !== undefined ? { figmaId: c.figmaId } : {}),
        ...(c.figmaFluidId !== undefined ? { figmaFluidId: c.figmaFluidId } : {}),
      };
    }
    for (const t of p.tokens ?? []) {
      ids.tokens[t.name] = {
        ...ids.tokens[t.name],
        ...(t.figmaId !== undefined ? { figmaId: t.figmaId } : {}),
        ...(t.figmaTextStyleId !== undefined
          ? { figmaTextStyleId: t.figmaTextStyleId }
          : {}),
      };
    }
    await this.writeFigmaIds(ids);
  }

  /** Follow token renames in the sidecar (no-op when the file is absent). */
  private async patchFigmaTokenRenames(renames: Map<string, string>): Promise<void> {
    if (renames.size === 0) return;
    try {
      await fs.access(this.figmaIdsPath());
    } catch {
      return;
    }
    const ids = await this.readFigmaIds();
    let changed = false;
    for (const [oldName, newName] of renames) {
      if (ids.tokens[oldName]) {
        ids.tokens[newName] = ids.tokens[oldName];
        delete ids.tokens[oldName];
        changed = true;
      }
    }
    if (changed) await this.writeFigmaIds(ids);
  }

  async updateCollectionTailwind(p: {
    collection: string;
    tailwind: CollectionDoc["tailwind"] | null;
  }): Promise<void> {
    const c = this.findSource(p.collection);
    this.replaceSource({ ...c, tailwind: p.tailwind ?? undefined });
    await this.commit([p.collection]);
  }

  async updateSurfacesConfig(p: {
    collection: string;
    config: SurfacesConfig | null;
  }): Promise<void> {
    const c = this.findSource(p.collection);
    this.replaceSource({ ...c, surfacesConfig: p.config ?? undefined });
    await this.commit([p.collection]);
  }

  async createCollection(p: {
    name: string;
    modes?: string[];
  }): Promise<void> {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(p.name)) {
      throw new Error(
        `Collection name "${p.name}" must be a simple identifier (it becomes the filename)`
      );
    }
    if (this.source.some((c) => c.name === p.name)) {
      throw new Error(`Collection "${p.name}" already exists`);
    }
    this.source = [
      ...this.source,
      { name: p.name, modes: p.modes ?? ["default"], tokens: [] },
    ];
    this.system = {
      ...this.system,
      collections: [...this.system.collections, p.name],
    };
    await this.commit([p.name], { system: true });
  }

  async removeCollection(p: { name: string }): Promise<void> {
    if (!this.source.some((c) => c.name === p.name)) {
      throw new Error(`Unknown collection "${p.name}"`);
    }
    this.source = this.source.filter((c) => c.name !== p.name);
    this.system = {
      ...this.system,
      collections: this.system.collections.filter((n) => n !== p.name),
    };
    await fs.rm(this.collectionPath(p.name), { force: true });
    await this.commit([], { system: true });
  }

  async updateSystem(p: {
    fluid?: SystemDoc["fluid"];
    useTailwindColors?: boolean;
    exportLayout?: SystemDoc["exportLayout"];
    name?: string;
    description?: string;
  }): Promise<void> {
    this.system = { ...this.system, ...p };
    await this.commit([], { system: true });
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
