# token-vault — AI agent reference

Everything an AI agent needs to read, create and edit design tokens in a
token-vault design system. This is the canonical reference; the
`AGENTS.md` scaffolded into each design-system folder is a compact
pointer to this document.

token-vault is **local-first**: tokens are plain JSON files in the repo,
`token-vault dev` serves a live editor at `localhost:4477`, and **git is
the history**. There are no accounts, no API keys and no rate limits.

## How to edit — pick one of three doors

| Door | When | How |
|---|---|---|
| **MCP tools** (preferred) | Interactive agent sessions | `npx token-vault-studio mcp -d design-system` (stdio). 14 tools, listed below. |
| **Direct file edits** | Bulk/scripted changes, refactors | Edit `design-system/**/*.json`, then validate with `npx token-vault-studio check`. |
| **HTTP RPC** | A dev server is already running | `POST http://localhost:4477/api/rpc` `{"method": "...", "params": {...}}` — same method names as the store mutations. |

**"MCP" here means the Model Context Protocol, not a remote service.**
The server is a local child process (stdio) that your agent client
launches and kills with the session — it reads and writes the same JSON
files, with no network, accounts or keys involved. Register it in
Claude Code with:

```bash
claude mcp add token-vault -- npx token-vault-studio mcp -d design-system
```

All three doors converge: the dev server's watcher absorbs file edits
and MCP writes the same way it absorbs human edits, and everything
recomputes live. **Always finish by running `npx token-vault-studio check`** — it catches
dangling references and schema errors.

### Safety workflow

1. **Checkpoint = git.** Before a substantive editing session, ensure the
   working tree is clean (or commit) so `git checkout design-system/` is
   the rollback.
2. Read before writing (`get_context` → `get_tokens_snapshot`).
3. Make the edits.
4. `check` (or the `analyze_accessibility` tool after color changes).
5. Commit with a descriptive message.

## File layout

```
design-system/
├── system.json           # name, fluid viewport/breakpoints, settings
├── collections/*.json    # one file per collection (tokens + configs)
└── dist/                 # `token-vault build` output (DTCG) — never edit
```

### system.json

```json
{
  "name": "Demo",
  "fluid": {
    "viewport": { "minWidth": 360, "maxWidth": 1440 },
    "breakpoints": [810, 1280]
  },
  "useTailwindColors": true,
  "exportLayout": "single",            // or "per-collection"
  "collections": ["core", "semantic"]  // filenames under collections/
}
```

`fluid.viewport` drives every fluid `clamp()` (Utopia-style
interpolation). Changing it recomputes all fluid tokens.

### collections/<name>.json

```json
{
  "name": "core",                  // MUST match the filename
  "modes": ["default"],            // or ["light", "dark"] for themes
  "groupOrder": ["brand", "space"],// optional display order of groups
  "generators": [ ... ],           // optional — see Generators
  "surfacesConfig": { ... },       // optional — see Surfaces helper
  "tailwind": { ... },             // optional export extension
  "tokens": [ ... ]                // hand-authored tokens ONLY
}
```

## Token identity and naming

- A token's **name is its identity**, dotted for grouping:
  `brand.accent`, `color.blue.600`, `space.m`. Names are unique across
  the whole system (all collections).
- References use names. **Renaming must cascade** — use the
  `rename_token` tool / `renameToken` RPC, which rewrites every alias,
  derivation, expression, composite slot and surfaces config across all
  files. If you rename by editing files directly, you must rewrite all
  references yourself (grep for the old name), then run `check`.
- A token whose name equals a group path (e.g. token `container` next to
  `container.narrow`) is that group's "base token" — the UI promotes it
  to the group header.

## Token shape

```json
{
  "name": "brand.accent",
  "type": "color",
  "description": "Primary interactive color",   // optional
  "values": { "<mode>": <value>, ... }
}
```

`type` is a DTCG type: `color`, `dimension`, `number`, `fontFamily`,
`fontWeight`, `duration`, `cubicBezier`, `transition`, `typography`,
`shadow`, `border`, `gradient`, `string`, `boolean`.

Per-mode values: a mode key may be omitted — the token then **inherits
the first mode's value** in that mode. Only write a mode key when the
value actually differs.

## Value encodings (the heart of the format)

Files store **editable intent**, not baked output. Six encodings:

### 1. Raw — plain scalar
```json
"values": { "default": "72rem" }
"values": { "default": "#3b82f6" }
"values": { "default": 400 }
"values": { "default": true }
```

### 2. Alias — `"{token.name}"`
```json
"values": { "default": "{color.blue.600}" }
```
Points at any token by name, including generated ones
(`color.blue.600` from a color generator, `space.m` from spacing).

### 3. Tailwind — `{"$tw": "…"}`
```json
"values": { "default": { "$tw": "slate-500" } }   // color → hex
"values": { "default": { "$tw": "font-bold" } }   // utility → 700
```
References the built-in Tailwind CSS v4 default theme. The ref is the
Tailwind utility class name. Besides `family-step` **colors**, it also
resolves the non-color scales, so you can lean on Tailwind's utilities
instead of re-deriving them:

| ref | resolves to | type |
|---|---|---|
| `font-{thin…black}` | `100`…`900` | fontWeight |
| `leading-{none…loose}` | `1`…`2` | line-height |
| `tracking-{tighter…widest}` | `-0.05em`…`0.1em` | letter-spacing |
| `text-{xs…9xl}` | `0.75rem`…`8rem` | font-size |
| `spacing-<n>` (`spacing-4`) | `n × 0.25rem` | spacing |
| `rounded-{none…4xl,full}` | radius | border-radius |
| `blur-*`, `breakpoint-*`, `container-*`, `shadow-*` | scale value | — |

Honors `system.useTailwindColors` (the master switch for all Tailwind
refs). Usable inside composite slots too — e.g. a `typography` token's
`fontWeight` / `lineHeight` / `letterSpacing` / `fontSize` slot:
`{"$composite": {"fontWeight": {"$tw": "font-semibold"}, "lineHeight": {"$tw": "leading-snug"}}}`.
On DTCG export the value is baked and the original ref + `var(--…)` form
is kept under `$extensions`.

### 4. Derived — `{"$derive": {base, ops}}` (colors)
```json
"values": { "default": { "$derive": {
  "base": { "kind": "token", "token": "brand.accent" },
  "ops": [ { "op": "shift", "stepStrength": 0.4 } ]
}}}
```
`base.kind`: `"token"` (`token`), `"tailwind"` (`color`), `"raw"`
(`value`, a hex). Ops run in order, all in OKLCH:

| op | params | effect |
|---|---|---|
| `lighten` / `darken` | `amount` 0–1 | ±L |
| `mute` | `amount` 0–1 | chroma × (1 − amount) |
| `mix` | `with` (token name), `weight` 0–1 | lerp toward another token |
| `autoContrast` | optional `threshold` (default 0.6), `light`/`dark` (token names) | picks a readable fg for the base |
| `shift` | `stepStrength` −1…1, optional `chromaDelta` | headroom-aware L/C shift (hover states) |

### 5. Expression — `{"$expr": "formula"}` (dimension / number)
```json
"values": { "default": { "$expr": "container * 0.75" } }
```
Identifiers are token names; `+ - * / ( )` and numbers allowed. Result
inherits the referenced tokens' unit math (computed in px).

### 6. Composite — `{"$composite": ...}` (typography / shadow / gradient / transition / border)
Slot values are themselves raw scalars or `"{alias}"` strings.

Single slot-map (typography, transition):
```json
"values": { "default": { "$composite": {
  "fontFamily": "Inter",
  "fontSize": "{type.step-1}",
  "fontWeight": 600,
  "letterSpacing": "0px",
  "lineHeight": 1.3
}}}
```

ARRAY of slot-maps = layers (shadow, gradient):
```json
"values": { "default": { "$composite": [
  { "color": "{color.neutral.900}", "offsetX": "0px", "offsetY": "1px",
    "blur": "3px", "spread": "0px" },
  { "color": "#00000014", "offsetX": "0px", "offsetY": "4px",
    "blur": "12px", "spread": "-2px", "inset": true }
]}}
```
Shadow slots: `color`, `offsetX`, `offsetY`, `blur`, `spread`, optional
`inset` (boolean). Gradient stops: `color`, `position` (0–1).
Transition slots: `duration`, `delay`, `timingFunction`. **Alias the
color slots to scale tokens instead of hardcoding hex.**

## Generated tokens — the one hard rule

Tokens flagged `generated: true` (in tool reads / the UI) are
**materialized from configs and never stored in source files**. They
recompute on every save.

> **Never create, edit or delete a generated token directly.** Edit the
> owning config instead: `update_generator` for scales,
> `update_surfaces` for surface levels. `update_token` / `delete_token`
> refuse them. Also avoid creating hand tokens under a generator's
> `groupPrefix` — they'd collide with regenerated names.

Renaming inside a generator config (its `groupPrefix`, a color family, a
spacing step) **does cascade**: token-vault rewrites every reference to
the old generated names automatically.

## Generators

Each generator lives in a collection's `generators` array:
`{ "id", "type", "groupPrefix", "config" }`. Generated names are
`groupPrefix.<rest>`.

### Color scale (`type: "color"`)
```json
"config": { "type": "color", "colorScaleConfig": {
  "steps": ["50","100", "...", "950"],
  "families": [{
    "name": "blue",
    "lightness": { "start": 0.97, "end": 0.25, "curve": "ease-out" },
    "chroma":    { "start": 0.025, "end": 0.09, "curve": "ease-in-out" },
    "hue":       { "start": 264,  "end": 264,  "curve": "linear" }
  }]
}}
```
Per-channel OKLCH curves; `curve`: `linear`, `ease`, `ease-in`,
`ease-out`, `ease-in-out`, or `{ "x1": …, "y1": …, "x2": …, "y2": … }`.
Channels may carry hand-tuned per-step `overrides` — **round-trip them
untouched; never drop fields you don't understand.** Emits
`<groupPrefix>.<family>.<step>`.

### Spacing (`type: "spacing"`)
```json
"config": { "type": "spacing", "spacingConfig": {
  "baseMin": 16, "baseMax": 24, "unit": "rem", "prefix": "space",
  "steps": [ { "name": "s", "multiplier": 1 },
             { "name": "m", "multiplier": 1.5 } ],
  "fixedValues": [2, 4, 8],
  "includePairs": true,
  "customPairs": [ { "from": "s", "to": "l" } ]
}}
```
Each step becomes `clamp()` between `multiplier×baseMin` @ viewport min
and `multiplier×baseMax` @ viewport max. `fixedValues` emit non-scaling
px tokens named by value (`space.4`). Pairs (`space.s-m`) interpolate
from one step's min to the next step's max.

### Typography (`type: "typography"`)
```json
"config": { "type": "typography", "typographyConfig": {
  "prefix": "", "unit": "rem", "baseStepIndex": 1,
  "steps": [ { "minPx": 12, "maxPx": 12 },
             { "minPx": 16, "maxPx": 18 },
             { "minPx": 20, "maxPx": 24 } ]
}}
```
Steps with `minPx === maxPx` are fixed (named by px value); fluid steps
are named `step-N` relative to `baseStepIndex` (negatives below base).

## Surfaces helper (`surfacesConfig`)

Derives a full themed color system (fg / fg-muted / border / hover per
surface per mode) from surface base colors, solving each level with APCA
contrast targets. Shape:

```json
"surfacesConfig": {
  "contrastThreshold": 0.6,
  "surfaces": [{
    "id": "s-bg", "name": "bg",
    "materializeBase": true, "bareLevels": true,
    "baseByMode": {
      "light": { "kind": "raw", "value": "#ffffff" },
      "dark":  { "kind": "alias", "token": "color.blue.950" }
    }
  }],
  "levels": [{
    "id": "l-fg", "name": "fg",
    "rule": { "kind": "fg",
      "onLight": { "target": { "kind": "apca", "lc": 90 },
                   "anchor": { "kind": "auto" } },
      "onDark":  { "target": { "kind": "apca", "lc": 90 },
                   "anchor": { "kind": "auto" } } }
  }, {
    "id": "l-hover", "name": "hover", "display": "bg",
    "rule": { "kind": "surface-shift",
      "onLight": { "stepStrength": 0.3 },
      "onDark":  { "stepStrength": 0.3 } }
  }]
}
```

Materialized names: `<surface>.<level>` (`surface.brand.fg`); a surface
with `bareLevels: true` emits bare level names (`fg`, `border`);
`materializeBase: true` also emits the base color as a token.

**Sacred granularity rules** (user preference, non-negotiable):
- Per-mode branches (`onLight`/`onDark`, `baseByMode` entries) and any
  per-surface / per-cell overrides must be preserved exactly. Never
  collapse modes or omit cells to "simplify".
- Muted foregrounds and borders on tinted surfaces MUST tint with the
  surface's hue. Never propose one flat neutral muted color shared
  across tinted surfaces — the APCA solver handles this when anchors
  are `auto`; don't fight it with raw overrides.

After any change to color scales or surfaces, run
`analyze_accessibility`: |Lc| ≥ 60 body text, ≥ 45 large text, ≥ 30
minimum for non-text.

## Design rules

- **Colors are OKLCH end-to-end.** Reason in lightness / chroma / hue.
  Prefer derivations (`$derive` with `autoContrast`, `mute`, `mix`) and
  aliases over hardcoded hex for semantic tokens.
- **Spacing/typography are fluid.** Don't hardcode px that bypasses the
  scale; for small static primitives use the spacing generator's
  `fixedValues`.
- **Layer semantics over primitives.** Semantic tokens (`brand.accent`,
  `focus-ring`) alias or derive from scale tokens; scales come from
  generators.

## MCP tools (14)

Read:
| tool | use |
|---|---|
| `get_context` | System overview: settings + collections + counts. **Start here.** |
| `get_tokens_snapshot` | Every token, resolved per mode. Cheapest full read. |
| `get_tokens` | One collection in full detail (source + generated, canonical values). |
| `list_generators` | Every generator + surfaces config — the editable intent. |

Write (accept the FILE encodings above — copy what you read in the repo):
| tool | use |
|---|---|
| `create_token` / `batch_create_tokens` | New hand-authored tokens. |
| `update_token` | Change values/type/description. Refuses `generated`. |
| `rename_token` | Rename + full reference cascade. |
| `delete_token` | Delete a hand-authored token. |
| `create_collection` | New collection file + system.json registration. |
| `update_generator` | Replace a generator config (recomputes immediately). |
| `update_surfaces` | Replace a surfaces config (null removes). |

Verify / export:
| tool | use |
|---|---|
| `analyze_accessibility` | APCA report per surface × level × mode. |
| `export_dtcg` | Bake DTCG into `design-system/dist/`. |

## HTTP RPC (dev server running)

`POST /api/rpc` with `{"method", "params"}` — methods: `createToken`,
`updateToken`, `removeToken`, `renameToken`, `renameGroup`,
`reorderTokens`, `addMode`, `renameMode`, `removeMode`, `reorderModes`,
`updateGroupOrder`, `addGenerator`, `updateGeneratorConfig`,
`removeGenerator`, `updateSurfacesConfig`, `updateCollectionTailwind`,
`createCollection`, `removeCollection`, `renameCollection`,
`updateSystem`. Token values here use the same file encodings. Response
is `{"ok": true, "snapshot": …}` or `{"error": "…"}` (422).
`GET /api/snapshot` reads everything.

## CLI

```bash
npx token-vault-studio init  [-d dir] [-n name]   # scaffold
npx token-vault-studio dev   [-d dir] [-p port]   # editor + RPC + watcher
npx token-vault-studio check [-d dir]             # validate (run after EVERY edit session)
npx token-vault-studio build [-d dir] [-o out]    # DTCG → dist/
npx token-vault-studio mcp   [-d dir]             # stdio MCP server
```

## Figma sync sidecar (`.figma-ids.json`)

The Figma plugin (pointed at `http://localhost:4477`) stores the Figma
Variable/Collection ids it created in `design-system/.figma-ids.json`,
keyed by token/collection NAME. The store cascades renames into it.
Never edit it by hand; deleting it makes the next sync create fresh
variables instead of updating existing ones. Endpoints:
`GET /api/figma/tokens`, `POST /api/figma/sync-ids`.

## DTCG output (`dist/`)

`build` / `export_dtcg` emit `tokens.json` (+ `$metadata.json`) in
Design Tokens Community Group format — colors in OKLCH, fluid values as
`clamp()`, composites as DTCG objects/arrays, mode metadata and the
optional Tailwind extension under `$extensions`. **`dist/` is build
output**: never edit it, and treat it as the contract consumers (CSS
pipelines, Figma sync, other repos) read.
