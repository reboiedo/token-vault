/**
 * External-save contract: helper editors (color / spacing / typography /
 * surfaces) own their draft + dirty state, but the dedicated route's
 * sticky header renders the Save/Discard buttons. The route passes refs
 * down; the editor keeps them pointed at its current save/discard and
 * reports dirtiness. When `saveRef` is provided, the editor hides its
 * inline buttons.
 */

import { useEffect } from "react";

export interface ExternalSaveProps {
  saveRef?: React.MutableRefObject<(() => void | Promise<void>) | null>;
  discardRef?: React.MutableRefObject<(() => void) | null>;
  onDirtyChange?: (dirty: boolean) => void;
}

/** Returns true when save UI is rendered externally (hide inline bar). */
export function useExternalSave(
  { saveRef, discardRef, onDirtyChange }: ExternalSaveProps,
  dirty: boolean,
  save: () => void | Promise<void>,
  discard: () => void
): boolean {
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // Keep the refs pointing at the latest closures on every render.
  useEffect(() => {
    if (saveRef) saveRef.current = save;
    if (discardRef) discardRef.current = discard;
  });

  useEffect(
    () => () => {
      if (saveRef) saveRef.current = null;
      if (discardRef) discardRef.current = null;
      onDirtyChange?.(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return !!saveRef;
}
