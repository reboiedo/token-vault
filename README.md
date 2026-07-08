# token-vault

Local-first design token studio. Your tokens live as **files in your
repo**, the editor runs on **localhost**, and **git is your history** —
no accounts, no cloud, no API limits. Think Storybook, for design
tokens.

```bash
npx token-vault-studio init        # scaffold design-system/ in your repo
npx token-vault-studio dev         # open the editor at localhost:4477
```

## How it works

```
design-system/
├── system.json              # name, fluid viewport/breakpoints, settings
├── collections/
│   ├── core.json            # generator configs + hand-authored tokens
│   └── semantic.json        # surfaces config (themes) + tokens
└── dist/                    # `token-vault build` output (DTCG)
    ├── tokens.json
    └── $metadata.json
```

The source files store **editable intent** — aliases stay
`"{color.blue.600}"`, expressions stay `{"$expr": "container * 0.75"}`,
Tailwind refs stay `{"$tw": "slate-500"}`. Everything `generated`
(color scales, fluid spacing/typography, surface levels) is recomputed
on the fly and never committed as source. Token identity is the dotted
name; renaming from the editor rewrites every reference across files.

Edit the JSON by hand, from the editor, or via an agent — a file
watcher keeps everything in sync, live.

## Features

- **Color scales**: OKLCH families with per-channel curves.
- **Fluid spacing & typography**: CSS `clamp()` from a viewport config.
- **Surfaces helper**: derive fg / muted / border / hover from each
  surface color with APCA contrast targets, per mode — with a live
  preview.
- **Value kinds**: raw, alias, Tailwind v4 palette, OKLCH derivation
  pipelines, arithmetic expressions, DTCG composites.
- **DTCG export**: `token-vault build` emits spec-format `tokens.json`
  (+ `$metadata.json` with the full generator/surfaces configs) for
  Style Dictionary and friends. `token-vault check` validates the
  source (dangling refs included) — CI-friendly.

## AI agents

token-vault is built to be agent-editable. Three doors, all converging
on the same files:

```bash
npx token-vault-studio mcp -d design-system   # local MCP server (preferred)
```

"MCP" is the Model Context Protocol — the standard way agent clients
talk to tools. **Nothing remote is involved**: the client launches this
as a local child process over stdio (like an LSP language server) and
it edits the same JSON files. 14 tools to read, create, update and
rename tokens, edit generator/surfaces configs, run APCA accessibility
reports and bake DTCG — no accounts, no API keys, no rate limits. The
server ships its own instructions, so any client learns the rules on
connect. Agents can also **edit the JSON files directly** (validate
with `token-vault check`) or hit `POST /api/rpc` on a running dev
server. Writes land in the files; a running `token-vault dev` picks
them up live.

- **Full agent reference**: [`docs/agents.md`](docs/agents.md) — file
  format, every value encoding, generator/surfaces schemas, tools, RPC.
- **Scaffolded guidance**: `token-vault init` drops an `AGENTS.md` into
  the design-system folder so agents opening the repo know the rules.
- **Claude Code skill**: copy [`skills/token-vault/`](skills/token-vault/)
  into `~/.claude/skills/` (or your project's `.claude/skills/`).

## Figma

The Token Vault Figma plugin **ships inside this package** — every
install carries the matching plugin build. Install it once per machine:

```bash
npx token-vault-studio figma
# prints .../node_modules/token-vault-studio/dist/figma-plugin/manifest.json
```

then in **Figma desktop**: Plugins → Development → Import plugin from
manifest… → pick the printed path. (See
[`figma-plugin/README.md`](figma-plugin/README.md) for details.)

To sync: run `npx token-vault-studio dev`, run the plugin, and enter
your project's local URL (`http://localhost:4477` by default) in the
connection field (instead of a cloud API key). It creates/updates Figma
variable collections + variables, text styles, effect styles (shadows)
and paint styles (gradients). Variable/collection ids are remembered in
`design-system/.figma-ids.json` — commit it so re-syncs (by anyone on
the team) update variables in place instead of duplicating. Renames
cascade into it like any other reference.

### One port per project (`devPort`)

Working on several token-vault projects at once? Give each repo its own
port so the plugin can never sync the wrong project into a Figma file:
set `"devPort"` in `design-system/system.json` (or Settings → Dev server
port in the studio) — `token-vault dev` picks it up automatically, and
`token-vault figma` prints the exact URL to enter in the plugin.
**Pick a port between 4470 and 4479**: the plugin's manifest allowlists
that range (Figma has no port wildcard). The plugin stores the
connection URL *inside each Figma file* (document plugin data), so every
file keeps pointing at its own project — and teammates opening the file
get the URL prefilled.

## Commands

| Command | |
|---|---|
| `token-vault init [-n name]` | scaffold `design-system/` |
| `token-vault dev [-p port] [-d dir]` | run the local editor (port: `--port` > `devPort` in system.json > 4477) |
| `token-vault build [-o out]` | bake DTCG to `dist/` |
| `token-vault check` | validate source files (exit ≠ 0 on errors) |
| `token-vault figma` | print the bundled Figma plugin's manifest path |
| `token-vault mcp` | MCP stdio server for agents |
