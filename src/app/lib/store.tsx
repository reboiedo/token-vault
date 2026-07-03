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
  useRef,
  useSyncExternalStore,
} from "react";
import type { CollectionDoc, SystemSnapshot } from "@core/types";

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
