/**
 * F1 shell: collection nav + read-only token table over the live
 * snapshot. The full editors (token table with editing, scale editors,
 * surfaces) port over in F2/F3 on top of the same store hooks.
 */

import { useState } from "react";
import {
  StoreProvider,
  useCollection,
  useCollections,
  useServerError,
  useSystem,
} from "./lib/store";
import type { TokenValue } from "@core/types";

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

function describeValue(v: TokenValue): { label: string; swatch?: string } {
  switch (v.type) {
    case "raw": {
      const s = String(v.value);
      return { label: s, swatch: s.startsWith("#") ? s : undefined };
    }
    case "alias":
      return { label: `{${v.token}}` };
    case "tailwind":
      return { label: `tw:${v.color}` };
    case "derived":
      return { label: `derived (${v.ops.length} ops)` };
    case "expression":
      return { label: `= ${v.formula}` };
    case "composite":
      return {
        label: Array.isArray(v.layers)
          ? `composite ×${v.layers.length}`
          : "composite",
      };
  }
}

function Shell() {
  const system = useSystem();
  const collections = useCollections();
  const serverError = useServerError();
  const [selected, setSelected] = useState<string | null>(null);
  const active = useCollection(selected ?? collections[0]?.name ?? null);

  if (!system) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-neutral-500">
        Connecting to token-vault…
      </div>
    );
  }

  return (
    <div className="flex h-screen font-sans text-sm">
      <aside className="w-56 shrink-0 border-r border-neutral-200 p-3 space-y-1">
        <h1 className="px-2 pb-2 font-semibold tracking-tight">
          {system.name}
        </h1>
        {collections.map((c) => (
          <button
            key={c.name}
            onClick={() => setSelected(c.name)}
            className={`block w-full rounded px-2 py-1 text-left hover:bg-neutral-100 ${
              active?.name === c.name ? "bg-neutral-100 font-medium" : ""
            }`}
          >
            {c.name}
            <span className="ml-1 text-xs text-neutral-400">
              {c.tokens.length}
            </span>
          </button>
        ))}
      </aside>

      <main className="flex-1 overflow-auto p-4">
        {serverError && (
          <div className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-red-800">
            {serverError}
          </div>
        )}
        {active ? (
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-neutral-400">
                <th className="border-b border-neutral-200 py-1.5 pr-4">
                  Token
                </th>
                {active.modes.map((m) => (
                  <th key={m} className="border-b border-neutral-200 py-1.5 pr-4">
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {active.tokens.map((t) => (
                <tr key={t.name} className="align-top">
                  <td className="border-b border-neutral-100 py-1.5 pr-4 font-mono text-xs">
                    {t.name}
                    {t.generated && (
                      <span className="ml-2 rounded bg-amber-100 px-1 text-[10px] text-amber-700">
                        gen
                      </span>
                    )}
                  </td>
                  {active.modes.map((mode) => {
                    const value = t.values[mode] ?? t.values["default"];
                    if (!value) {
                      return (
                        <td
                          key={mode}
                          className="border-b border-neutral-100 py-1.5 pr-4 text-neutral-300"
                        >
                          —
                        </td>
                      );
                    }
                    const { label, swatch } = describeValue(value);
                    return (
                      <td
                        key={mode}
                        className="border-b border-neutral-100 py-1.5 pr-4 font-mono text-xs"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {swatch && (
                            <span
                              className="h-3.5 w-3.5 rounded border border-neutral-200"
                              style={{ background: swatch }}
                            />
                          )}
                          {label}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-neutral-400">No collections.</div>
        )}
      </main>
    </div>
  );
}
