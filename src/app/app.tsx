/**
 * Editor shell: collection nav + per-collection tabs (Tokens /
 * Generators / Surfaces). All state flows from the WS snapshot; all
 * edits flow through /api/rpc (see lib/store.tsx).
 */

import { useState } from "react";
import {
  StoreProvider,
  useCollection,
  useCollections,
  useServerError,
  useSystem,
} from "./lib/store";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TokenTableView } from "./views/token-table";
import { GeneratorEditorView } from "./views/generator-editor";
import { SurfacesEditorView } from "./views/surfaces-editor";
import type { SurfacesConfig } from "@core/surfaces-utils";
import { cn } from "@/lib/utils";

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

function Shell() {
  const system = useSystem();
  const collections = useCollections();
  const serverError = useServerError();
  const [selected, setSelected] = useState<string | null>(null);
  const active = useCollection(selected ?? collections[0]?.name ?? null);

  if (!system) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Connecting to token-vault…
      </div>
    );
  }

  const hasSurfaces = !!(active?.surfacesConfig as SurfacesConfig | undefined);
  const hasGenerators = (active?.generators?.length ?? 0) > 0;

  return (
    <div className="flex h-screen font-sans text-sm">
      <aside className="w-56 shrink-0 space-y-1 border-r p-3">
        <h1 className="px-2 pb-2 font-semibold tracking-tight">
          {system.name}
        </h1>
        {collections.map((c) => (
          <button
            key={c.name}
            onClick={() => setSelected(c.name)}
            className={cn(
              "block w-full rounded px-2 py-1 text-left transition hover:bg-accent",
              active?.name === c.name && "bg-accent font-medium"
            )}
          >
            {c.name}
            <span className="ml-1 text-xs text-muted-foreground">
              {c.tokens.length}
            </span>
          </button>
        ))}
      </aside>

      <main className="flex-1 overflow-auto p-4">
        {serverError && (
          <div className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {serverError}
          </div>
        )}
        {active ? (
          <Tabs defaultValue="tokens" key={active.name}>
            <TabsList className="mb-3">
              <TabsTrigger value="tokens">Tokens</TabsTrigger>
              <TabsTrigger value="generators">
                Generators
                {hasGenerators && (
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    {active.generators!.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="surfaces">
                Surfaces
                {hasSurfaces && (
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    ●
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="tokens">
              <TokenTableView collection={active} />
            </TabsContent>
            <TabsContent value="generators">
              <GeneratorEditorView collection={active} />
            </TabsContent>
            <TabsContent value="surfaces">
              <SurfacesEditorView collection={active} />
            </TabsContent>
          </Tabs>
        ) : (
          <div className="text-muted-foreground">No collections.</div>
        )}
      </main>
    </div>
  );
}
