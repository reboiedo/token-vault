# Design tokens — instructions for AI agents

This folder is a [token-vault](https://github.com/reboiedo/token-vault)
design system: tokens live in these JSON files, `npx @rebo89/token-vault dev`
serves a live editor, and git is the history. Full agent reference:
`node_modules/token-vault/docs/agents.md` (or `docs/agents.md` in the
token-vault repo).

## Editing

Preferred: the MCP server — `npx @rebo89/token-vault mcp -d <this folder>`
(Model Context Protocol over stdio: a **local child process**, no
remote service; 14 tools; `get_context` first). Direct file edits are fine too.
If a dev server is running, `POST localhost:4477/api/rpc` works as well.

**Always run `npx @rebo89/token-vault check -d <this folder>` after editing** —
it catches dangling references. Commit before big sessions; git is the
rollback.

## Format in 30 seconds

- `system.json` — name, fluid viewport/breakpoints (drives all
  `clamp()`), collection list.
- `collections/*.json` — `modes`, optional `generators` /
  `surfacesConfig`, and hand-authored `tokens`.
- Token identity = its dotted **name** (`brand.accent`). Renames must
  cascade to every reference — use the `rename_token` tool, not sed.
- Per-mode values, six encodings:
  - raw scalar: `"#3b82f6"`, `"72rem"`, `400`
  - alias: `"{color.blue.600}"`
  - Tailwind: `{"$tw": "slate-500"}`
  - derived color: `{"$derive": {"base": {...}, "ops": [...]}}`
  - expression: `{"$expr": "container * 0.75"}`
  - composite: `{"$composite": {...}}` or `[{...}, ...]` for
    shadow/gradient layers
- A missing mode key inherits the first mode's value.

## Hard rules

1. **Never edit `generated: true` tokens** — they're recomputed from
   `generators` / `surfacesConfig`. Edit those configs instead. Don't
   create tokens under a generator's `groupPrefix`.
2. **Round-trip configs faithfully** — modify only what you mean to
   change; never drop fields you don't understand (channel `overrides`,
   per-mode branches, per-cell overrides are hand-tuned and sacred).
3. Colors are **OKLCH**; prefer aliases/derivations over hardcoded hex
   for semantic tokens. Spacing/typography are **fluid** — don't bypass
   the scale with raw px (use spacing `fixedValues` for static
   primitives).
4. Muted text/borders on tinted surfaces must **tint with the surface's
   hue** — never one flat neutral shared across tinted surfaces.
5. After color/surfaces changes run the `analyze_accessibility` tool
   (APCA: |Lc| ≥ 60 body, ≥ 45 large, ≥ 30 minimum).
6. `dist/` is build output (`npx @rebo89/token-vault build`) — never edit it.
