/**
 * Client-side reference resolution — memoized over the live snapshot.
 * Same walk the server uses (core/resolve), so pickers and swatches
 * agree with the materializer.
 */

import { useMemo } from "react";
import { buildResolver, type Resolver } from "@core/resolve";
import { useSnapshot } from "./store";

const EMPTY: Resolver = {
  resolveRaw: () => null,
  aliasOptions: () => [],
  get: () => undefined,
};

export function useResolver(): Resolver {
  const snapshot = useSnapshot();
  return useMemo(
    () => (snapshot ? buildResolver(snapshot.collections) : EMPTY),
    [snapshot]
  );
}
