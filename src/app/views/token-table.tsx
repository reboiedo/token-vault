/**
 * TokenTableView — cloud-parity token table
 * (port of web/src/components/token-table.tsx):
 *
 *   · resizable columns persisted in localStorage (col-widths:<collection>)
 *   · mode column headers: click-to-rename ("default" locked) + "+ Mode"
 *   · nested collapsible groups; double-click group rename; a token whose
 *     name equals the group path is PROMOTED to the group header row
 *   · "Manual" vs "Helper-managed" sections (generated = read-only, Lock)
 *   · per-row type icon, hover ⋯ menu (Edit Details / Delete)
 *   · per-group "New variable" dropdown (type list) with auto-focus rename
 *   · dnd-kit row drag, cross-group drops rename the token (refs follow)
 */

import { Fragment, useEffect, useMemo, useState } from "react";
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
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Bold,
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  FileText,
  Hash,
  Layers,
  Lock,
  MoreHorizontal,
  Palette,
  Plus,
  Ruler,
  Spline,
  Timer,
  ToggleLeft,
  Type as TypeIcon,
  type LucideIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ValueCell } from "@/components/value-cell";
import { defaultValueFor } from "@/components/collection-header";
import type { CollectionDoc, TokenDoc, TokenType } from "@core/types";
import { useActions } from "@/lib/store";
import { cn } from "@/lib/utils";

// ============================================================================
// TYPE ICONS — verbatim from the cloud table
// ============================================================================

const TOKEN_TYPE_ICONS: Partial<Record<TokenType, LucideIcon>> = {
  color: Palette,
  dimension: Ruler,
  fontFamily: CaseSensitive,
  fontWeight: Bold,
  duration: Timer,
  cubicBezier: Spline,
  number: Hash,
  shadow: Layers,
  border: Layers,
  typography: FileText,
  gradient: Palette,
  transition: Timer,
  string: TypeIcon,
  boolean: ToggleLeft,
};

function TypeIconFor({ type }: { type?: TokenType }) {
  const Icon = (type && TOKEN_TYPE_ICONS[type]) || Hash;
  return <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

// ============================================================================
// COLUMN RESIZE — widths persisted per collection, like the cloud
// ============================================================================

function useColumnResize(collectionName: string, modes: string[]) {
  const storageKey = `col-widths:${collectionName}`;
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(widths));
    } catch {
      /* private mode */
    }
  }, [storageKey, widths]);

  const width = (col: string) =>
    widths[col] ?? (col === "name" ? 220 : col === "__add" ? 110 : 170);

  const startResize = (col: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width(col);
    const move = (ev: PointerEvent) => {
      setWidths((prev) => ({
        ...prev,
        [col]: Math.max(60, startW + ev.clientX - startX),
      }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  void modes;
  return { width, startResize };
}

function ResizeHandle({ onPointerDown }: { onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <span
      onPointerDown={onPointerDown}
      className="absolute right-0 top-0 h-full w-1 cursor-col-resize select-none hover:bg-primary/40"
    />
  );
}

// ============================================================================
// GROUP TREE
// ============================================================================

interface GroupNode {
  /** Full dotted path of the group ("color", "color.blue"). */
  path: string;
  label: string;
  /** Token whose name === path, promoted to the header row. */
  baseToken: TokenDoc | null;
  tokens: TokenDoc[];
  children: GroupNode[];
}

function buildTree(
  tokens: TokenDoc[],
  groupOrder: string[] | undefined
): { roots: GroupNode[]; ungrouped: TokenDoc[] } {
  const rootMap = new Map<string, GroupNode>();
  const ungrouped: TokenDoc[] = [];

  const nodeFor = (path: string, label: string, map: Map<string, GroupNode>) => {
    let n = map.get(path);
    if (!n) {
      n = { path, label, baseToken: null, tokens: [], children: [] };
      map.set(path, n);
    }
    return n;
  };

  const childMaps = new Map<string, Map<string, GroupNode>>();

  for (const t of tokens) {
    const parts = t.name.split(".");
    if (parts.length === 1) {
      ungrouped.push(t);
      continue;
    }
    const root = nodeFor(parts[0], parts[0], rootMap);
    if (parts.length === 2) {
      root.tokens.push(t);
    } else {
      // 3+ segments → one nested level (color.blue.500 → color > blue)
      const subPath = `${parts[0]}.${parts[1]}`;
      let subMap = childMaps.get(parts[0]);
      if (!subMap) {
        subMap = new Map();
        childMaps.set(parts[0], subMap);
      }
      const sub = nodeFor(subPath, parts[1], subMap);
      if (parts.length === 3) sub.tokens.push(t);
      else sub.tokens.push(t); // deeper names stay flat within the subgroup
    }
  }

  // Base-token promotion: a single-segment token matching a group path.
  for (const t of ungrouped.slice()) {
    const g = rootMap.get(t.name);
    if (g) {
      g.baseToken = t;
      ungrouped.splice(ungrouped.indexOf(t), 1);
    }
  }

  for (const [rootName, subMap] of childMaps) {
    const root = rootMap.get(rootName) ?? nodeFor(rootName, rootName, rootMap);
    const subs = [...subMap.values()].sort((a, b) => a.label.localeCompare(b.label));
    // Promote two-segment tokens matching a subgroup path.
    for (const sub of subs) {
      const idx = root.tokens.findIndex((t) => t.name === sub.path);
      if (idx >= 0) {
        sub.baseToken = root.tokens[idx];
        root.tokens.splice(idx, 1);
      }
    }
    root.children = subs;
  }

  const order = groupOrder ?? [];
  const roots = [...rootMap.values()].sort((a, b) => {
    const ia = order.indexOf(a.path);
    const ib = order.indexOf(b.path);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.path.localeCompare(b.path);
  });
  return { roots, ungrouped };
}

const countTokens = (n: GroupNode): number =>
  n.tokens.length + (n.baseToken ? 1 : 0) + n.children.reduce((s, c) => s + countTokens(c), 0);

// ============================================================================
// INLINE NAME EDITOR
// ============================================================================

function InlineName({
  value,
  className,
  autoFocus = false,
  display,
  onCommit,
}: {
  value: string;
  className?: string;
  autoFocus?: boolean;
  display: React.ReactNode;
  onCommit: (next: string) => void;
}) {
  const [editing, setEditing] = useState(autoFocus);
  const [draft, setDraft] = useState(value);
  if (!editing) {
    return (
      <button
        type="button"
        className={cn("truncate rounded px-1 py-0.5 text-left transition hover:bg-accent", className)}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
      >
        {display}
      </button>
    );
  }
  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
  };
  return (
    <Input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      className="h-6 w-full max-w-56 font-mono text-xs"
    />
  );
}

// ============================================================================
// NEW VARIABLE BUTTON — per-group type dropdown, like the cloud
// ============================================================================

const NEW_VARIABLE_TYPES: (TokenType | "sep")[] = [
  "color", "dimension", "number", "sep",
  "fontFamily", "fontWeight", "typography", "sep",
  "duration", "cubicBezier", "sep",
  "string", "boolean",
];

function NewVariableButton({
  group,
  collection,
  indent,
  colSpan,
  onCreated,
}: {
  group: string;
  collection: CollectionDoc;
  indent: string;
  colSpan: number;
  onCreated: (name: string) => void;
}) {
  const actions = useActions();
  const create = async (type: TokenType) => {
    const leaf = `untitled-${Date.now()}`;
    const name = group ? `${group}.${leaf}` : leaf;
    await actions.createToken({
      collection: collection.name,
      token: {
        name,
        type,
        values: Object.fromEntries(
          collection.modes.map((m) => [m, defaultValueFor(type)])
        ),
      },
    });
    onCreated(name);
  };
  return (
    <tr>
      <td colSpan={colSpan} className={cn("py-0.5", indent)}>
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground/70 transition hover:bg-accent hover:text-foreground">
            <Plus className="h-3 w-3" /> New variable
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {NEW_VARIABLE_TYPES.map((t, i) =>
              t === "sep" ? (
                <DropdownMenuSeparator key={`s${i}`} />
              ) : (
                <DropdownMenuItem
                  key={t}
                  className="text-xs capitalize"
                  onClick={() => void create(t)}
                >
                  <TypeIconFor type={t} /> {t}
                </DropdownMenuItem>
              )
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

// ============================================================================
// TOKEN ROW (sortable when manual)
// ============================================================================

function TokenRow({
  token,
  collection,
  depth,
  autoFocus,
  width,
  draggable,
  onRename,
  onRemove,
  onEditDetails,
}: {
  token: TokenDoc;
  collection: CollectionDoc;
  depth: number;
  autoFocus: boolean;
  width: (col: string) => number;
  draggable: boolean;
  onRename: (next: string) => void;
  onRemove: () => void;
  onEditDetails: () => void;
}) {
  const sortable = useSortable({ id: token.name, disabled: !draggable });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable;

  // Don't let dnd-kit's keyboard listeners swallow typing in inputs.
  const guardedListeners = draggable
    ? {
        ...listeners,
        onKeyDown: (e: React.KeyboardEvent) => {
          const t = e.target as HTMLElement;
          if (t.closest("input, textarea, select, [contenteditable=true]")) return;
          (listeners as Record<string, (e: unknown) => void>)?.onKeyDown?.(e);
        },
      }
    : {};

  const leaf = token.name.split(".").pop()!;
  const indentPad = depth === 0 ? "pl-3" : depth === 1 ? "pl-9" : "pl-14";

  return (
    <tr
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : undefined,
      }}
      {...(draggable ? attributes : {})}
      {...guardedListeners}
      className={cn("group/row align-middle", isDragging && "cursor-grabbing")}
    >
      <td
        className={cn("border-b border-neutral-100 py-1 pr-2 dark:border-neutral-800", indentPad)}
        style={{ width: width("name"), maxWidth: width("name") }}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <TypeIconFor type={token.type} />
          {token.generated ? (
            <span
              className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground"
              title="Generated by a helper — edit the helper config to change"
            >
              <span className="truncate">{leaf}</span>
              <Lock className="h-3 w-3 shrink-0 opacity-50" />
            </span>
          ) : (
            <InlineName
              value={token.name}
              autoFocus={autoFocus}
              className="min-w-0 font-mono text-xs"
              display={leaf}
              onCommit={(next) => onRename(next)}
            />
          )}
        </span>
      </td>
      {collection.modes.map((mode) => (
        <td
          key={mode}
          className="border-b border-neutral-100 py-1 pr-2 dark:border-neutral-800"
          style={{ width: width(mode), maxWidth: width(mode) }}
        >
          <ValueCell token={token} mode={mode} />
        </td>
      ))}
      <td className="border-b border-neutral-100 dark:border-neutral-800" />
      <td className="w-9 border-b border-neutral-100 text-right dark:border-neutral-800">
        {!token.generated && (
          <DropdownMenu>
            <DropdownMenuTrigger className="rounded p-1 opacity-0 transition hover:bg-accent group-hover/row:opacity-100">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="text-xs" onClick={onEditDetails}>
                Edit Details
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                className="text-xs"
                onClick={() => {
                  if (confirm(`Delete token "${token.name}"?`)) onRemove();
                }}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </td>
    </tr>
  );
}

// ============================================================================
// GROUP RENDERING (recursive)
// ============================================================================

function GroupRows({
  node,
  depth,
  collection,
  collapsed,
  toggle,
  readOnly,
  width,
  colSpan,
  autoFocusToken,
  onCreated,
  onEditDetails,
}: {
  node: GroupNode;
  depth: number;
  collection: CollectionDoc;
  collapsed: Set<string>;
  toggle: (path: string) => void;
  readOnly: boolean;
  width: (col: string) => number;
  colSpan: number;
  autoFocusToken: string | null;
  onCreated: (name: string) => void;
  onEditDetails: (token: TokenDoc) => void;
}) {
  const actions = useActions();
  const isCollapsed = collapsed.has(node.path);
  const chevron = isCollapsed ? (
    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
  ) : (
    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
  );
  const indentPad = depth === 0 ? "pl-1" : "pl-6";

  const headerLabel = readOnly ? (
    <span className="font-mono text-xs text-muted-foreground" title="Generated group">
      {node.label}
    </span>
  ) : (
    <InlineName
      value={node.path}
      className="font-mono text-xs font-medium"
      display={node.label}
      onCommit={(next) =>
        void actions.renameGroup({
          collection: collection.name,
          oldPrefix: node.path,
          newPrefix: next,
        })
      }
    />
  );

  return (
    <Fragment>
      {node.baseToken ? (
        /* Base token promoted: real value cells on the group header row */
        <tr className="group/row bg-muted/20 align-middle">
          <td
            className={cn("border-b py-1 pr-2", indentPad)}
            style={{ width: width("name"), maxWidth: width("name") }}
          >
            <span className="flex min-w-0 items-center gap-1">
              <button type="button" onClick={() => toggle(node.path)} className="rounded p-0.5 hover:bg-accent">
                {chevron}
              </button>
              <TypeIconFor type={node.baseToken.type} />
              {headerLabel}
              <span className="text-[10px] text-muted-foreground">
                ({countTokens(node)})
              </span>
            </span>
          </td>
          {collection.modes.map((mode) => (
            <td key={mode} className="border-b py-1 pr-2" style={{ width: width(mode), maxWidth: width(mode) }}>
              <ValueCell token={node.baseToken!} mode={mode} />
            </td>
          ))}
          <td className="border-b" />
          <td className="w-9 border-b text-right">
            {!node.baseToken.generated && (
              <DropdownMenu>
                <DropdownMenuTrigger className="rounded p-1 opacity-0 transition hover:bg-accent group-hover/row:opacity-100">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="text-xs" onClick={() => onEditDetails(node.baseToken!)}>
                    Edit Details
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    className="text-xs"
                    onClick={() => {
                      if (confirm(`Delete token "${node.baseToken!.name}"?`))
                        void actions.removeToken({ name: node.baseToken!.name });
                    }}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </td>
        </tr>
      ) : (
        <tr className="bg-muted/20">
          <td colSpan={colSpan} className={cn("border-b py-1", indentPad)}>
            <span className="flex items-center gap-1">
              <button type="button" onClick={() => toggle(node.path)} className="rounded p-0.5 hover:bg-accent">
                {chevron}
              </button>
              {headerLabel}
              <span className="text-[10px] text-muted-foreground">({countTokens(node)})</span>
            </span>
          </td>
        </tr>
      )}
      {!isCollapsed && (
        <Fragment>
          {node.children.map((child) => (
            <GroupRows
              key={child.path}
              node={child}
              depth={depth + 1}
              collection={collection}
              collapsed={collapsed}
              toggle={toggle}
              readOnly={readOnly}
              width={width}
              colSpan={colSpan}
              autoFocusToken={autoFocusToken}
              onCreated={onCreated}
              onEditDetails={onEditDetails}
            />
          ))}
          {node.tokens.map((t) => (
            <TokenRow
              key={t.name}
              token={t}
              collection={collection}
              depth={depth + 1}
              autoFocus={t.name === autoFocusToken}
              width={width}
              draggable={!readOnly && !t.generated}
              onRename={(next) =>
                void actions
                  .renameToken({ name: t.name, newName: next })
                  .catch((err) => alert(String(err.message)))
              }
              onRemove={() => void actions.removeToken({ name: t.name })}
              onEditDetails={() => onEditDetails(t)}
            />
          ))}
          {!readOnly && (
            <NewVariableButton
              group={node.path}
              collection={collection}
              indent={depth === 0 ? "pl-9" : "pl-14"}
              colSpan={colSpan}
              onCreated={onCreated}
            />
          )}
        </Fragment>
      )}
    </Fragment>
  );
}

// ============================================================================
// MODE HEADERS
// ============================================================================

function ModeHeadCell({
  mode,
  collection,
  width,
  onResize,
}: {
  mode: string;
  collection: CollectionDoc;
  width: number;
  onResize: (e: React.PointerEvent) => void;
}) {
  const actions = useActions();
  const isDefault = mode === "default";
  return (
    <th
      className="relative border-b py-1.5 pr-2 text-left font-medium"
      style={{ width, maxWidth: width }}
    >
      {isDefault ? (
        <span className="cursor-default" title="Default mode cannot be renamed">
          {mode}
        </span>
      ) : (
        <InlineName
          value={mode}
          display={mode}
          onCommit={(next) =>
            void actions
              .renameMode({ collection: collection.name, oldName: mode, newName: next })
              .catch((err) => alert(String(err.message)))
          }
        />
      )}
      <ResizeHandle onPointerDown={onResize} />
    </th>
  );
}

function AddModeCell({ collection }: { collection: CollectionDoc }) {
  const actions = useActions();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  return (
    <th className="border-b py-1.5 pr-2 text-left font-normal">
      {adding ? (
        <Input
          autoFocus
          value={draft}
          placeholder="mode name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setAdding(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setAdding(false);
            if (e.key === "Enter" && draft.trim()) {
              void actions
                .addMode({ collection: collection.name, mode: draft.trim() })
                .catch(() => undefined);
              setDraft("");
              setAdding(false);
            }
          }}
          className="h-6 w-24 text-xs"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground/70 transition hover:bg-accent hover:text-foreground"
        >
          <Plus className="h-3 w-3" /> Mode
        </button>
      )}
    </th>
  );
}

// ============================================================================
// MAIN VIEW
// ============================================================================

export function TokenTableView({
  collection,
  filterGroup = null,
  autoFocusToken = null,
  onEditDetails = () => undefined,
}: {
  collection: CollectionDoc;
  filterGroup?: string | null;
  autoFocusToken?: string | null;
  /** Opens the token editor dialog (wired by the page in P4). */
  onEditDetails?: (token: TokenDoc) => void;
}) {
  const actions = useActions();
  const { width, startResize } = useColumnResize(collection.name, collection.modes);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [focusName, setFocusName] = useState<string | null>(null);
  const effectiveFocus = focusName ?? autoFocusToken;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const visible = useMemo(
    () =>
      filterGroup
        ? collection.tokens.filter(
            (t) => t.name === filterGroup || t.name.startsWith(`${filterGroup}.`)
          )
        : collection.tokens,
    [collection.tokens, filterGroup]
  );

  const manual = useMemo(() => visible.filter((t) => !t.generated), [visible]);
  const generated = useMemo(() => visible.filter((t) => t.generated), [visible]);
  const manualTree = useMemo(
    () => buildTree(manual, collection.groupOrder),
    [manual, collection.groupOrder]
  );
  const generatedTree = useMemo(
    () => buildTree(generated, collection.groupOrder),
    [generated, collection.groupOrder]
  );

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const colSpan = 3 + collection.modes.length;

  // Cross-group drop: rename into the target's group, then reorder the
  // source list so the dragged token lands next to the drop target.
  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeName = String(active.id);
    const overName = String(over.id);
    const groupOf = (n: string) => (n.includes(".") ? n.slice(0, n.lastIndexOf(".")) : "");
    const leafOf = (n: string) => n.split(".").pop()!;
    const sourceNames = collection.tokens.filter((t) => !t.generated).map((t) => t.name);

    let finalName = activeName;
    if (groupOf(activeName) !== groupOf(overName)) {
      const target = groupOf(overName);
      finalName = target ? `${target}.${leafOf(activeName)}` : leafOf(activeName);
      try {
        await actions.renameToken({ name: activeName, newName: finalName });
      } catch (err) {
        alert(String((err as Error).message));
        return;
      }
    }
    const names = sourceNames.map((n) => (n === activeName ? finalName : n));
    const from = names.indexOf(finalName);
    const to = names.indexOf(overName);
    if (from < 0 || to < 0) return;
    names.splice(to, 0, ...names.splice(from, 1));
    await actions.reorderTokens({ collection: collection.name, names });
  };

  const renderSection = (
    tree: ReturnType<typeof buildTree>,
    readOnly: boolean
  ) => (
    <Fragment>
      {tree.roots.map((node) => (
        <GroupRows
          key={node.path}
          node={node}
          depth={0}
          collection={collection}
          collapsed={collapsed}
          toggle={toggle}
          readOnly={readOnly}
          width={width}
          colSpan={colSpan}
          autoFocusToken={effectiveFocus}
          onCreated={setFocusName}
          onEditDetails={onEditDetails}
        />
      ))}
      {tree.ungrouped.map((t) => (
        <TokenRow
          key={t.name}
          token={t}
          collection={collection}
          depth={0}
          autoFocus={t.name === effectiveFocus}
          width={width}
          draggable={!readOnly && !t.generated}
          onRename={(next) =>
            void actions
              .renameToken({ name: t.name, newName: next })
              .catch((err) => alert(String(err.message)))
          }
          onRemove={() => void actions.removeToken({ name: t.name })}
          onEditDetails={() => onEditDetails(t)}
        />
      ))}
      {!readOnly && (
        <NewVariableButton
          group={filterGroup ?? ""}
          collection={collection}
          indent="pl-3"
          colSpan={colSpan}
          onCreated={setFocusName}
        />
      )}
    </Fragment>
  );

  const hasGenerated = generated.length > 0;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th
              className="relative border-b py-1.5 pr-2 font-medium"
              style={{ width: width("name"), maxWidth: width("name") }}
            >
              Name
              <ResizeHandle onPointerDown={startResize("name")} />
            </th>
            {collection.modes.map((m) => (
              <ModeHeadCell
                key={m}
                mode={m}
                collection={collection}
                width={width(m)}
                onResize={startResize(m)}
              />
            ))}
            <AddModeCell collection={collection} />
            <th className="w-9 border-b" />
          </tr>
        </thead>
        <tbody className="text-xs">
          {hasGenerated && (
            <tr>
              <td colSpan={colSpan} className="pb-1 pt-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Manual
              </td>
            </tr>
          )}
          <SortableContext
            items={manual.map((t) => t.name)}
            strategy={verticalListSortingStrategy}
          >
            {manual.length || !hasGenerated ? (
              renderSection(manualTree, false)
            ) : (
              <tr>
                <td colSpan={colSpan} className="py-2 text-muted-foreground">
                  No manual tokens yet — use “Add Token” or “New variable”.
                </td>
              </tr>
            )}
          </SortableContext>
          {hasGenerated && (
            <Fragment>
              <tr>
                <td colSpan={colSpan} className="pb-1 pt-4 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Lock className="h-3 w-3" /> Helper-managed · edit the helper
                    config to change
                  </span>
                </td>
              </tr>
              {renderSection(generatedTree, true)}
            </Fragment>
          )}
          {visible.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="py-6 text-center text-muted-foreground">
                {filterGroup
                  ? `No tokens in "${filterGroup}"`
                  : "No tokens yet. Click “Add Token” to create one."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </DndContext>
  );
}
