/**
 * Editor shell — cloud-parity layout:
 *
 *   SidebarProvider
 *   ├── AppSidebar (CollectionsNav + GroupsNav + footer Settings)
 *   └── SidebarInset
 *       ├── sticky header (SidebarTrigger · CollectionHeader · JSON)
 *       └── body: generator/surfaces cards + token table
 *
 * Routes (wouter): `/` main page (`?collection=` selects), dedicated
 * `/generators/:id` and `/surfaces/:collection` editor views with a
 * back affordance — same shape as the cloud's dedicated routes.
 */

import { useMemo, useRef, useState } from "react";
import { Route, Switch as RouteSwitch, useLocation, useSearch } from "wouter";
import {
  ArrowLeft,
  Code,
  Palette,
  Plus,
  Ruler,
  Settings2,
  Sparkles,
  Trash2,
  Type,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  StoreProvider,
  useCollection,
  useCollections,
  useServerError,
  useSystem,
} from "./lib/store";
import { useActions } from "./lib/store";
import { CollectionsNav } from "@/components/collections-nav";
import { GroupsNav } from "@/components/groups-nav";
import { CollectionHeader } from "@/components/collection-header";
import { SettingsDialog } from "@/components/settings-dialog";
import {
  AddGeneratorDialog,
  CreateCollectionDialog,
  JsonPreviewDialog,
} from "@/components/shell-dialogs";
import { TokenEditorDialog } from "@/components/token-editor-dialog";
import { TokenTableView } from "./views/token-table";
import { GeneratorEditorView } from "./views/generator-editor";
import { SurfacesEditorView } from "./views/surfaces-editor";
import type { CollectionDoc, GeneratorDef, TokenDoc } from "@core/types";
import type { SurfacesConfig } from "@core/surfaces-utils";

export function App() {
  return (
    <StoreProvider>
      <RouteSwitch>
        <Route path="/generators/:id">
          {(params) => <DedicatedRoute generatorId={params.id} />}
        </Route>
        <Route path="/surfaces/:collection">
          {(params) => (
            <DedicatedRoute surfacesCollection={decodeURIComponent(params.collection)} />
          )}
        </Route>
        <Route>
          <MainPage />
        </Route>
      </RouteSwitch>
    </StoreProvider>
  );
}

// ============================================================================
// SHARED CHROME
// ============================================================================

function useActiveCollection(): [CollectionDoc | null, (name: string) => void] {
  const [, navigate] = useLocation();
  const collections = useCollections();
  // useLocation only tracks the pathname, so a search-only navigation
  // (/?collection=a → /?collection=b) never re-renders. useSearch
  // subscribes to the query string itself.
  const search = useSearch();
  const fromQuery = useMemo(
    () => new URLSearchParams(search).get("collection"),
    [search]
  );
  const active =
    useCollection(fromQuery) ?? (collections.length ? collections[0] : null);
  const select = (name: string) =>
    navigate(`/?collection=${encodeURIComponent(name)}`);
  return [active, select];
}

function AppShell({
  header,
  sidebarExtra,
  children,
  activeName,
  onSelectCollection,
}: {
  header: React.ReactNode;
  sidebarExtra?: React.ReactNode;
  children: React.ReactNode;
  activeName: string | null;
  onSelectCollection: (name: string) => void;
}) {
  const system = useSystem();
  const collections = useCollections();
  const serverError = useServerError();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  if (!system) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Connecting to token-vault…
      </div>
    );
  }

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <div className="truncate px-2 py-1 text-sm font-semibold tracking-tight">
            {system.name}
          </div>
        </SidebarHeader>
        <SidebarContent>
          <CollectionsNav
            collections={collections}
            activeName={activeName}
            onSelect={onSelectCollection}
            onCreate={() => setCreateOpen(true)}
          />
          {sidebarExtra}
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => setSettingsOpen(true)}>
                <Settings2 /> Settings
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-5" />
          {header}
        </header>
        <div className="flex-1 overflow-auto p-4">
          {serverError && (
            <div className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {serverError}
            </div>
          )}
          {children}
        </div>
      </SidebarInset>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <CreateCollectionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={onSelectCollection}
      />
    </SidebarProvider>
  );
}

// ============================================================================
// MAIN PAGE — cards + token table
// ============================================================================

const GENERATOR_CARD_META: Record<
  GeneratorDef["type"],
  { icon: typeof Palette; tint: string }
> = {
  color: { icon: Palette, tint: "text-purple-600" },
  spacing: { icon: Ruler, tint: "text-blue-600" },
  typography: { icon: Type, tint: "text-teal-600" },
};

function MainPage() {
  const system = useSystem();
  const collections = useCollections();
  const [active, select] = useActiveCollection();
  const [, navigate] = useLocation();
  const actions = useActions();
  const [jsonOpen, setJsonOpen] = useState(false);
  const [addGenOpen, setAddGenOpen] = useState(false);
  const [filterGroup, setFilterGroup] = useState<string | null>(null);
  const [autoFocusToken, setAutoFocusToken] = useState<string | null>(null);
  const [editingToken, setEditingToken] = useState<TokenDoc | null>(null);

  const totalTokens = collections.reduce((n, c) => n + c.tokens.length, 0);
  const hasSurfaces = !!(active?.surfacesConfig as SurfacesConfig | undefined);

  return (
    <AppShell
      activeName={active?.name ?? null}
      onSelectCollection={(name) => {
        setFilterGroup(null);
        select(name);
      }}
      sidebarExtra={
        active && (
          <GroupsNav
            collection={active}
            activeGroup={filterGroup}
            onSelectGroup={setFilterGroup}
          />
        )
      }
      header={
        <>
          {active ? (
            <CollectionHeader
              collection={active}
              onTokenCreated={setAutoFocusToken}
            />
          ) : (
            <span className="font-semibold">{system?.name}</span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setJsonOpen(true)}
              title="Preview the generated DTCG files"
            >
              <Code className="h-3.5 w-3.5" /> JSON
            </Button>
          </div>
        </>
      }
    >
      {active ? (
        <div className="space-y-4">
          {/* Generator / helper cards */}
          <div className="flex flex-wrap items-stretch gap-2">
            {(active.generators ?? []).map((g) => {
              const meta = GENERATOR_CARD_META[g.type];
              const Icon = meta.icon;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() =>
                    navigate(
                      `/generators/${g.id}?collection=${encodeURIComponent(active.name)}`
                    )
                  }
                  className="group flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition hover:bg-accent"
                >
                  <Icon className={`h-4 w-4 ${meta.tint}`} />
                  <span className="font-mono text-xs">
                    {g.groupPrefix ? `${g.groupPrefix}.*` : "(root)"}
                  </span>
                  <span
                    role="button"
                    className="rounded p-0.5 opacity-0 transition hover:text-destructive group-hover:opacity-100"
                    title="Remove generator (its tokens are deleted)"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm("Remove this generator? Generated tokens will be deleted.")) {
                        void actions.removeGenerator({
                          collection: active.name,
                          generatorId: g.id,
                        });
                      }
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </span>
                </button>
              );
            })}
            {hasSurfaces && (
              <button
                type="button"
                onClick={() =>
                  navigate(`/surfaces/${encodeURIComponent(active.name)}`)
                }
                className="group flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition hover:bg-accent"
              >
                <Sparkles className="h-4 w-4 text-amber-500" />
                <span className="text-xs">Surfaces helper</span>
                <span
                  role="button"
                  className="rounded p-0.5 opacity-0 transition hover:text-destructive group-hover:opacity-100"
                  title="Remove the surfaces helper (hand-authored tokens survive)"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm("Remove the surfaces helper? Its generated levels disappear; hand-authored tokens are kept.")) {
                      void actions.updateSurfacesConfig({
                        collection: active.name,
                        config: null,
                      });
                    }
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setAddGenOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground transition hover:bg-accent"
            >
              <Plus className="h-3.5 w-3.5" /> Generator
            </button>
          </div>

          <TokenTableView
            collection={active}
            filterGroup={filterGroup}
            autoFocusToken={autoFocusToken}
            onEditDetails={setEditingToken}
          />

          {editingToken && (
            <TokenEditorDialog
              open={!!editingToken}
              onOpenChange={(open) => !open && setEditingToken(null)}
              token={
                active.tokens.find((t) => t.name === editingToken.name) ??
                editingToken
              }
              collection={active}
            />
          )}

          <AddGeneratorDialog
            open={addGenOpen}
            onOpenChange={setAddGenOpen}
            collection={active}
            onSurfacesAdded={() =>
              navigate(`/surfaces/${encodeURIComponent(active.name)}`)
            }
          />
        </div>
      ) : (
        /* Overview: no collection selected / none exist */
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <h2 className="text-lg font-semibold">{system?.name}</h2>
          {system?.description && (
            <p className="text-sm text-muted-foreground">{system.description}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {collections.length} collections · {totalTokens} tokens
          </p>
        </div>
      )}
      <JsonPreviewDialog open={jsonOpen} onOpenChange={setJsonOpen} />
    </AppShell>
  );
}

// ============================================================================
// DEDICATED ROUTES — generator / surfaces editors with a back header
// ============================================================================

function DedicatedRoute({
  generatorId,
  surfacesCollection,
}: {
  generatorId?: string;
  surfacesCollection?: string;
}) {
  const collections = useCollections();
  const [, navigate] = useLocation();
  const [active, select] = useActiveCollection();

  // Editors keep their draft state; the sticky header owns Save/Discard.
  const saveRef = useRef<(() => void | Promise<void>) | null>(null);
  const discardRef = useRef<(() => void) | null>(null);
  const [dirty, setDirty] = useState(false);
  const externalSave = { saveRef, discardRef, onDirtyChange: setDirty };

  const collection = surfacesCollection
    ? collections.find((c) => c.name === surfacesCollection) ?? null
    : collections.find((c) =>
        (c.generators ?? []).some((g) => g.id === generatorId)
      ) ?? null;
  const generator = generatorId
    ? collection?.generators?.find((g) => g.id === generatorId) ?? null
    : null;

  const title = surfacesCollection
    ? `Surfaces · ${surfacesCollection}`
    : generator
      ? `${generator.type} generator · ${generator.groupPrefix || "(root)"}`
      : "Not found";

  return (
    <AppShell
      activeName={active?.name ?? null}
      onSelectCollection={select}
      header={
        <>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() =>
              navigate(
                collection
                  ? `/?collection=${encodeURIComponent(collection.name)}`
                  : "/"
              )
            }
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
          <span className="truncate text-sm font-semibold">{title}</span>
          {dirty && (
            <div className="ml-auto flex items-center gap-1.5">
              <span className="mr-1 text-xs text-muted-foreground">
                Unsaved changes
              </span>
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => void saveRef.current?.()}
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => discardRef.current?.()}
              >
                Discard
              </Button>
            </div>
          )}
        </>
      }
    >
      {collection && surfacesCollection && (
        <SurfacesEditorView collection={collection} {...externalSave} />
      )}
      {collection && generator && (
        <GeneratorEditorView
          collection={collection}
          onlyGeneratorId={generator.id}
          {...externalSave}
        />
      )}
      {!collection && (
        <p className="text-sm text-muted-foreground">
          This editor's collection no longer exists.
        </p>
      )}
    </AppShell>
  );
}
