---
name: token-vault
description: Edit design tokens in a local token-vault design system (design-system/ folder with system.json + collections/*.json). Use when the user asks to create, edit, rename or audit tokens, color scales, spacing/typography scales, surfaces/themes, shadows or gradients in a repo that contains a token-vault design system.
---

# Editing design tokens (token-vault, local-first)

Tokens are **files in the repo** (`design-system/` by default), the
editor is `npx token-vault dev` on localhost, and **git is history and
rollback**. No accounts, no rate limits. Full reference:
`docs/agents.md` in the token-vault package/repo; each scaffolded
design-system also carries an `AGENTS.md`.

## Workflow

0. **Git is the checkpoint.** Before a substantive session, make sure
   the tree is clean or commit — `git checkout <design-system-dir>/` is
   the rollback. Commit again when done.
1. **Pick the door.**
   - MCP (preferred if connected): tools named `get_context`,
     `get_tokens_snapshot`, `create_token`, `update_generator`, etc.
     It's a local stdio child process editing the same files — nothing
     remote. Start every session with `get_context`.
   - Files: edit `design-system/**/*.json` directly — the live editor
     absorbs external edits via its watcher.
   - RPC: if a dev server runs, `POST localhost:4477/api/rpc`
     `{"method","params"}`.
2. **Read before writing.** `get_context` → `get_tokens_snapshot`
   (cheapest full read) → `get_tokens` / `list_generators` for detail.
3. **Verify after editing.** `npx token-vault check -d <dir>` catches
   dangling refs and schema errors — run it after EVERY session. After
   color/surfaces changes also run `analyze_accessibility`
   (APCA: |Lc| ≥ 60 body, ≥ 45 large, ≥ 30 minimum).

## Hard rules

- **Never edit `generated: true` tokens.** They rematerialize from
  configs on every save. Edit the owning config instead:
  `update_generator` (color/spacing/typography scales) or
  `update_surfaces` (themes). Don't create hand tokens under a
  generator's `groupPrefix`.
- **Rename with the tool** (`rename_token` / `renameToken` RPC) so every
  alias, derivation, expression, composite slot and surfaces ref is
  rewritten across files. Never rename via delete+create or sed.
  Renames inside generator configs (groupPrefix, color family, step
  names) cascade automatically.
- **Round-trip configs faithfully.** Start from what `list_generators`
  returns and change only what you mean to. Channel `overrides`,
  per-mode branches (`onLight`/`onDark`, `baseByMode`) and per-cell
  overrides are hand-tuned — never drop or collapse them.
- Muted foregrounds/borders on tinted surfaces MUST tint with the
  surface hue — never one flat neutral shared across tinted surfaces.

## Value encodings (files, MCP and RPC all accept these)

- raw scalar: `"#3b82f6"`, `"72rem"`, `400`, `true`
- alias: `"{color.blue.600}"` (dotted token NAME — names are identity)
- Tailwind palette: `{"$tw": "slate-500"}`
- derived color: `{"$derive": {"base": {"kind": "token", "token": "brand.accent"}, "ops": [{"op": "shift", "stepStrength": 0.4}]}}`
  — ops: `lighten`/`darken` (amount), `mute` (amount), `mix` (with,
  weight), `autoContrast` (threshold), `shift` (stepStrength ±1,
  chromaDelta). All OKLCH.
- expression (dimension/number): `{"$expr": "container * 0.75"}` —
  identifiers are token names.
- composite: `{"$composite": {slot: value}}`; shadow/gradient use an
  ARRAY of layers: shadow slots `color`/`offsetX`/`offsetY`/`blur`/
  `spread`/`inset?`, gradient stops `color`/`position` (0–1). Alias the
  color slots to scale tokens.
- Omitted mode key = inherits the first mode's value; only write a mode
  key when the value differs.

## Design defaults

- Colors OKLCH end-to-end; semantic tokens alias/derive from scales, not
  hardcoded hex.
- Spacing/typography are fluid `clamp()` driven by
  `system.json → fluid.viewport`; use spacing `fixedValues` for static
  px primitives (2, 4, 8…), never raw px that bypasses the scale.
- `dist/` is build output (`npx token-vault build`) — never edit it.
