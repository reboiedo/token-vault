# Token Vault — Figma plugin

Syncs design tokens from a token-vault design system into Figma:
variable collections + variables (with breakpoint/fluid modes), text
styles (typography composites), effect styles (shadows), and paint
styles (gradients). One-directional: design system → Figma. Figma ids
are reported back to the server and remembered in
`design-system/.figma-ids.json`, so re-syncs update in place.

## Install (ships with the npm package)

The built plugin is bundled inside `token-vault-studio` — no separate
download or build:

```bash
npx token-vault-studio figma   # prints the manifest path + these steps
```

1. **Figma desktop** → **Plugins** → **Development** →
   **Import plugin from manifest…**
2. Pick the printed `…/dist/figma-plugin/manifest.json`.

Everyone on the team gets the plugin version matching the installed
`token-vault-studio` — update the dependency, re-import the manifest if
the path changed, done.

## Use

1. `npx token-vault-studio dev` in the repo that holds `design-system/`.
2. Run the **Token Vault** plugin in Figma and enter
   `http://localhost:4477` in the connection field.
3. Sync. Commit the updated `design-system/.figma-ids.json`.

Local mode needs Figma **desktop** (dev network access to
`http://localhost:4477`). A cloud API key in the same field still
targets the legacy cloud backend (`*.convex.site`).

## Development (in this repo)

```bash
pnpm build:plugin        # → dist/figma-plugin/{manifest.json,main.js,ui.html}
npx tsc --noEmit -p figma-plugin
```

Source layout:

```
figma-plugin/
├── manifest.json   # source manifest (build rewrites main/ui to bare paths)
├── src/
│   ├── main.ts     # plugin sandbox entry point
│   ├── ui.html     # iframe UI (JS inlined, built single-file)
│   ├── api.ts      # cloud/local endpoint selection + fetch client
│   ├── sync.ts     # variable/style sync logic
│   └── utils.ts    # value + CSS color → Figma conversions
└── tsconfig.json
```

The build is driven by `scripts/build-figma-plugin.mjs` (root Vite,
IIFE bundle for `main.js`, single-file HTML for `ui.html`).
