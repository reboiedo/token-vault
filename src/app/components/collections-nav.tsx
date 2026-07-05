/**
 * CollectionsNav — sidebar list of collections, port of the cloud's
 * collections-nav.tsx: derived kind icon, token count, double-click
 * inline rename, hover "…" menu with Rename/Delete, and a "+" button
 * in the group label to create a collection.
 */

import { useState } from "react";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { CollectionDoc } from "@core/types";
import { getEffectiveKind, KIND_ICONS } from "@/lib/collection-kind";
import { useActions } from "@/lib/store";

export function CollectionsNav({
  collections,
  activeName,
  onSelect,
  onCreate,
}: {
  collections: CollectionDoc[];
  activeName: string | null;
  onSelect: (name: string) => void;
  onCreate: () => void;
}) {
  const actions = useActions();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const commitRename = async (oldName: string) => {
    const next = draft.trim();
    setRenaming(null);
    if (next && next !== oldName) {
      try {
        await actions.renameCollection({ name: oldName, newName: next });
        if (activeName === oldName) onSelect(next);
      } catch (err) {
        alert(String((err as Error).message));
      }
    }
  };

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Collections</SidebarGroupLabel>
      <SidebarGroupAction title="New collection" onClick={onCreate}>
        <Plus /> <span className="sr-only">New collection</span>
      </SidebarGroupAction>
      <SidebarMenu>
        {collections.map((c) => {
          const Icon = KIND_ICONS[getEffectiveKind(c)];
          return (
            <SidebarMenuItem key={c.name}>
              {renaming === c.name ? (
                <Input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => void commitRename(c.name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitRename(c.name);
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="h-7 font-mono text-xs"
                />
              ) : (
                <>
                  <SidebarMenuButton
                    isActive={activeName === c.name}
                    onClick={() => onSelect(c.name)}
                    onDoubleClick={() => {
                      setRenaming(c.name);
                      setDraft(c.name);
                    }}
                    title="Double-click to rename"
                  >
                    <Icon />
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {c.tokens.length}
                    </span>
                  </SidebarMenuButton>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <SidebarMenuAction showOnHover>
                          <MoreHorizontal />
                          <span className="sr-only">More</span>
                        </SidebarMenuAction>
                      }
                    />
                    <DropdownMenuContent align="start" side="right">
                      <DropdownMenuItem
                        className="text-xs"
                        onClick={() => {
                          setRenaming(c.name);
                          setDraft(c.name);
                        }}
                      >
                        <Pencil className="h-3 w-3" /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        className="text-xs"
                        onClick={() => {
                          if (
                            confirm(
                              "Delete this collection and all its tokens?"
                            )
                          ) {
                            void actions.removeCollection({ name: c.name });
                          }
                        }}
                      >
                        <Trash2 className="h-3 w-3" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
