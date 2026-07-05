/**
 * EditThemesDialog — full mode management for a collection, port of the
 * cloud's edit-themes-dialog.tsx: native drag to reorder, pencil rename
 * (gated for "default"), trash delete (gated for "default"/last), and
 * an inline Add Theme row.
 */

import { useState } from "react";
import { Check, GripVertical, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CollectionDoc } from "@core/types";
import { useActions } from "@/lib/store";
import { cn } from "@/lib/utils";

export function EditThemesDialog({
  open,
  onOpenChange,
  collection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collection: CollectionDoc;
}) {
  const actions = useActions();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(String((err as Error).message));
    }
  };

  const commitRename = (oldName: string) => {
    const next = renameDraft.trim();
    setRenaming(null);
    if (next && next !== oldName) {
      void run(() =>
        actions.renameMode({
          collection: collection.name,
          oldName,
          newName: next,
        })
      );
    }
  };

  const drop = () => {
    if (dragIndex === null || overIndex === null || dragIndex === overIndex) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }
    const next = [...collection.modes];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(overIndex, 0, moved);
    setDragIndex(null);
    setOverIndex(null);
    void run(() =>
      actions.reorderModes({ collection: collection.name, modes: next })
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Themes</DialogTitle>
          <DialogDescription>
            Themes are the modes of this collection — drag to reorder.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          {collection.modes.map((mode, i) => {
            const isDefault = mode === "default";
            const isLast = collection.modes.length <= 1;
            return (
              <div
                key={mode}
                draggable={renaming !== mode}
                onDragStart={() => setDragIndex(i)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverIndex(i);
                }}
                onDragEnd={drop}
                className={cn(
                  "group flex items-center gap-2 rounded-md border px-2 py-1.5",
                  overIndex === i && dragIndex !== null && "border-primary",
                  dragIndex === i && "opacity-50"
                )}
              >
                <GripVertical className="h-3.5 w-3.5 cursor-grab text-muted-foreground/60" />
                {renaming === mode ? (
                  <>
                    <Input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(mode);
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      className="h-7 flex-1 font-mono text-xs"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => commitRename(mode)}
                    >
                      <Check className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setRenaming(null)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 font-mono text-xs">{mode}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 disabled:opacity-0"
                      disabled={isDefault}
                      title={
                        isDefault ? "Default mode cannot be renamed" : "Rename"
                      }
                      onClick={() => {
                        setRenaming(mode);
                        setRenameDraft(mode);
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 hover:text-destructive disabled:opacity-0"
                      disabled={isDefault || isLast}
                      title={
                        isDefault
                          ? "Default mode cannot be removed"
                          : isLast
                            ? "A collection needs at least one mode"
                            : "Delete theme (removes its values)"
                      }
                      onClick={() =>
                        confirm(
                          `Delete theme "${mode}"? Its values on every token will be removed.`
                        ) &&
                        void run(() =>
                          actions.removeMode({
                            collection: collection.name,
                            mode,
                          })
                        )
                      }
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {adding ? (
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={addDraft}
              placeholder="high-contrast"
              onChange={(e) => setAddDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && addDraft.trim()) {
                  void run(() =>
                    actions.addMode({
                      collection: collection.name,
                      mode: addDraft.trim(),
                    })
                  );
                  setAddDraft("");
                  setAdding(false);
                }
                if (e.key === "Escape") setAdding(false);
              }}
              className="h-7 flex-1 font-mono text-xs"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => {
                if (addDraft.trim()) {
                  void run(() =>
                    actions.addMode({
                      collection: collection.name,
                      mode: addDraft.trim(),
                    })
                  );
                }
                setAddDraft("");
                setAdding(false);
              }}
            >
              <Check className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setAdding(false)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-fit"
            onClick={() => setAdding(true)}
          >
            <Plus className="h-3.5 w-3.5" /> Add Theme
          </Button>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
