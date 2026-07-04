# token-vault

Local-first design token studio. Your tokens live as **files in your
repo**, the editor runs on **localhost**, and **git is your history** —
no accounts, no cloud, no API limits. Think Storybook, for design
tokens.

```bash
npx token-vault init        # scaffold design-system/ in your repo
npx token-vault dev         # open the editor at localhost:4477
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

## MCP (agents)

```bash
npx token-vault mcp   # stdio server over the same files
```

Point Claude Code (or any MCP client) at it and agents can read,
create, update and rename tokens, edit generator/surfaces configs, run
APCA accessibility reports and bake DTCG — no API keys, no rate limits.
Writes land in the files; a running `token-vault dev` picks them up
live.

## Commands

| Command | |
|---|---|
| `token-vault init [-n name]` | scaffold `design-system/` |
| `token-vault dev [-p 4477] [-d dir]` | run the local editor |
| `token-vault build [-o out]` | bake DTCG to `dist/` |
| `token-vault check` | validate source files (exit ≠ 0 on errors) |
| `token-vault mcp` | MCP stdio server for agents |
