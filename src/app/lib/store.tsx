/**
 * Client-side data layer — token-vault's replacement for Convex's
 * `useQuery` reactivity. One WebSocket subscription delivers the full
 * `SystemSnapshot` (rev-guarded); components read slices of it through
 * hooks backed by `useSyncExternalStore`.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import type {
  CollectionDoc,
  GeneratorDef,
  SystemDoc,
  SystemSnapshot,
  TokenDoc,
  TokenValue,
} from "@core/types";
import type { SurfacesConfig } from "@core/surfaces-utils";

type Listener = () => void;

class SnapshotClient {
  private snapshot: SystemSnapshot | null = null;
  private listeners = new Set<Listener>();
  private ws: WebSocket | null = null;
  private retryTimer: number | null = null;
  /** Load error surfaced by the server (invalid files on disk). */
  serverError: string | null = null;

  connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "snapshot") {
        // rev guard: never apply an older snapshot over a newer one.
        if (!this.snapshot || msg.rev >= this.snapshot.rev) {
          this.snapshot = msg.data;
          this.serverError = null;
          this.notify();
        }
      } else if (msg.type === "error") {
        this.serverError = msg.message;
        this.notify();
      }
    };
    this.ws.onclose = () => {
      this.retryTimer = window.setTimeout(() => this.connect(), 1000);
    };
  }

  disconnect() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close();
  }

  private notify() {
    for (const l of this.listeners) l();
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = () => this.snapshot;

  /** Apply an RPC response snapshot (rev-guarded, same as WS frames). */
  applySnapshot(snapshot: SystemSnapshot) {
    if (!this.snapshot || snapshot.rev >= this.snapshot.rev) {
      this.snapshot = snapshot;
      this.serverError = null;
      this.notify();
    }
  }
}

const StoreContext = createContext<SnapshotClient | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const clientRef = useRef<SnapshotClient | null>(null);
  if (!clientRef.current) clientRef.current = new SnapshotClient();

  useEffect(() => {
    const client = clientRef.current!;
    client.connect();
    return () => client.disconnect();
  }, []);

  return (
    <StoreContext.Provider value={clientRef.current}>
      {children}
    </StoreContext.Provider>
  );
}

function useClient(): SnapshotClient {
  const client = useContext(StoreContext);
  if (!client) throw new Error("StoreProvider missing");
  return client;
}

/** The whole snapshot — null until the first WS frame arrives. */
export function useSnapshot(): SystemSnapshot | null {
  const client = useClient();
  return useSyncExternalStore(client.subscribe, client.getSnapshot);
}

export function useSystem() {
  return useSnapshot()?.system ?? null;
}

export function useCollections(): CollectionDoc[] {
  return useSnapshot()?.collections ?? [];
}

export function useCollection(name: string | null): CollectionDoc | null {
  const collections = useCollections();
  return collections.find((c) => c.name === name) ?? null;
}

/** Server-reported load error (invalid files on disk), if any. */
export function useServerError(): string | null {
  const client = useClient();
  const subscribe = useCallback(client.subscribe, [client]);
  return useSyncExternalStore(subscribe, () => client.serverError);
}

// ============================================================================
// MUTATIONS — token-vault's replacement for Convex's useMutation. Each
// action POSTs /api/rpc; the response snapshot is applied immediately
// (localhost RTT makes optimistic updates unnecessary). Errors throw so
// callers can toast/inline them.
// ============================================================================

async function rpc(client: SnapshotClient, method: string, params: unknown) {
  const res = await fetch("/api/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `RPC ${method} failed`);
  client.applySnapshot(body.snapshot);
}

export interface Actions {
  createToken(p: { collection: string; token: TokenDoc; index?: number }): Promise<void>;
  updateToken(p: {
    name: string;
    values?: Record<string, TokenValue>;
    type?: TokenDoc["type"];
    description?: string;
  }): Promise<void>;
  removeToken(p: { name: string }): Promise<void>;
  renameToken(p: { name: string; newName: string }): Promise<void>;
  renameGroup(p: { collection: string; oldPrefix: string; newPrefix: string }): Promise<void>;
  reorderTokens(p: { collection: string; names: string[] }): Promise<void>;
  addMode(p: { collection: string; mode: string }): Promise<void>;
  renameMode(p: { collection: string; oldName: string; newName: string }): Promise<void>;
  removeMode(p: { collection: string; mode: string }): Promise<void>;
  reorderModes(p: { collection: string; modes: string[] }): Promise<void>;
  createCollection(p: { name: string; modes?: string[] }): Promise<void>;
  removeCollection(p: { name: string }): Promise<void>;
  renameCollection(p: { name: string; newName: string }): Promise<void>;
  updateGroupOrder(p: { collection: string; groupOrder: string[] }): Promise<void>;
  addGenerator(p: { collection: string; generator: GeneratorDef }): Promise<void>;
  updateGeneratorConfig(p: {
    collection: string;
    generatorId: string;
    config: GeneratorDef["config"];
    groupPrefix?: string;
  }): Promise<void>;
  removeGenerator(p: { collection: string; generatorId: string }): Promise<void>;
  updateSurfacesConfig(p: { collection: string; config: SurfacesConfig | null }): Promise<void>;
  updateCollectionTailwind(p: {
    collection: string;
    tailwind: CollectionDoc["tailwind"] | null;
  }): Promise<void>;
  updateSystem(
    p: Partial<
      Pick<SystemDoc, "fluid" | "useTailwindColors" | "exportLayout" | "name" | "description">
    > & { devPort?: number | null }
  ): Promise<void>;
}

export function useActions(): Actions {
  const client = useClient();
  return useMemo(() => {
    const make =
      <P,>(method: string) =>
      (params: P) =>
        rpc(client, method, params);
    return {
      createToken: make("createToken"),
      updateToken: make("updateToken"),
      removeToken: make("removeToken"),
      renameToken: make("renameToken"),
      renameGroup: make("renameGroup"),
      reorderTokens: make("reorderTokens"),
      addMode: make("addMode"),
      renameMode: make("renameMode"),
      removeMode: make("removeMode"),
      reorderModes: make("reorderModes"),
      createCollection: make("createCollection"),
      removeCollection: make("removeCollection"),
      renameCollection: make("renameCollection"),
      updateGroupOrder: make("updateGroupOrder"),
      addGenerator: make("addGenerator"),
      updateGeneratorConfig: make("updateGeneratorConfig"),
      removeGenerator: make("removeGenerator"),
      updateSurfacesConfig: make("updateSurfacesConfig"),
      updateCollectionTailwind: make("updateCollectionTailwind"),
      updateSystem: make("updateSystem"),
    } satisfies Actions;
  }, [client]);
}
