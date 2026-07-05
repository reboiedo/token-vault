/**
 * GroupsNav — sidebar list of the active collection's token groups,
 * port of the cloud's groups-nav.tsx: "All" item + one entry per
 * dotted prefix with count, drag-to-reorder (dnd-kit) persisted via
 * `updateGroupOrder`, and double-click inline rename via `renameGroup`
 * (which rewrites every token in the group, references following).
 */

import { useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FolderOpen, Layers } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import type { CollectionDoc } from "@core/types";
import { useActions } from "@/lib/store";

function groupOf(name: string): string {
  const dot = name.indexOf(".");
  return dot < 0 ? "" : name.slice(0, dot);
}

function SortableGroupItem({
  group,
  count,
  isActive,
  onSelect,
  onRename,
}: {
  group: string;
  count: number;
  isActive: boolean;
  onSelect: () => void;
  onRename: (next: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: group });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(group);

  return (
    <SidebarMenuItem
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : undefined,
      }}
      {...attributes}
      {...listeners}
    >
      {editing ? (
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (draft.trim() && draft.trim() !== group) onRename(draft.trim());
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setEditing(false);
              if (draft.trim() && draft.trim() !== group) onRename(draft.trim());
            }
            if (e.key === "Escape") setEditing(false);
          }}
          className="h-7 font-mono text-xs"
        />
      ) : (
        <SidebarMenuButton
          isActive={isActive}
          onClick={onSelect}
          onDoubleClick={() => {
            setDraft(group);
            setEditing(true);
          }}
          title="Double-click to rename (references follow)"
        >
          <FolderOpen />
          <span className="flex-1 truncate">{group}</span>
          <span className="text-xs text-muted-foreground">{count}</span>
        </SidebarMenuButton>
      )}
    </SidebarMenuItem>
  );
}

export function GroupsNav({
  collection,
  activeGroup,
  onSelectGroup,
}: {
  collection: CollectionDoc;
  activeGroup: string | null;
  onSelectGroup: (group: string | null) => void;
}) {
  const actions = useActions();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of collection.tokens) {
      const g = groupOf(t.name);
      if (!g) continue;
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    const order = collection.groupOrder ?? [];
    const names = [...counts.keys()].sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
    return names.map((name) => ({ name, count: counts.get(name)! }));
  }, [collection]);

  if (groups.length === 0) return null;

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const names = groups.map((g) => g.name);
    const next = arrayMove(
      names,
      names.indexOf(String(active.id)),
      names.indexOf(String(over.id))
    );
    void actions.updateGroupOrder({
      collection: collection.name,
      groupOrder: next,
    });
  };

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Groups</SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={activeGroup === null}
            onClick={() => onSelectGroup(null)}
          >
            <Layers />
            <span className="flex-1 truncate">All</span>
            <span className="text-xs text-muted-foreground">
              {collection.tokens.length}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={groups.map((g) => g.name)}
            strategy={verticalListSortingStrategy}
          >
            {groups.map((g) => (
              <SortableGroupItem
                key={g.name}
                group={g.name}
                count={g.count}
                isActive={activeGroup === g.name}
                onSelect={() => onSelectGroup(g.name)}
                onRename={(next) =>
                  void actions.renameGroup({
                    collection: collection.name,
                    oldPrefix: g.name,
                    newPrefix: next,
                  })
                }
              />
            ))}
          </SortableContext>
        </DndContext>
      </SidebarMenu>
    </SidebarGroup>
  );
}
