/**
 * TokenTableView — the editable token table for one collection.
 * Groups rows by dotted prefix (respecting groupOrder), renders a
 * ValueCell per mode, and hosts rename / create / delete. Reordering
 * by drag is a follow-up (TODO: dnd-kit, like the cloud table).
 */

import { useMemo, useState } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ValueCell } from "@/components/value-cell";
import type { CollectionDoc, TokenDoc, TokenType } from "@core/types";
import { useActions } from "@/lib/store";

function groupOf(name: string): string {
  const dot = name.indexOf(".");
  return dot < 0 ? "" : name.slice(0, dot);
}

function TokenNameCell({
  token,
  autoFocus = false,
}: {
  token: TokenDoc;
  autoFocus?: boolean;
}) {
  const actions = useActions();
  const [editing, setEditing] = useState(autoFocus);
  const [draft, setDraft] = useState(token.name);

  if (token.generated) {
    return (
      <span className="font-mono text-xs">
        {token.name}
        <span className="ml-2 rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          gen
        </span>
      </span>
    );
  }

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={async (e) => {
          if (e.key === "Escape") setEditing(false);
          if (e.key === "Enter") {
            const next = draft.trim();
            setEditing(false);
            if (next && next !== token.name) {
              try {
                await actions.renameToken({ name: token.name, newName: next });
              } catch (err) {
                alert(String((err as Error).message));
                setDraft(token.name);
              }
            }
          }
        }}
        className="h-6 w-56 font-mono text-xs"
      />
    );
  }

  return (
    <button
      type="button"
      className="rounded px-1 py-0.5 font-mono text-xs hover:bg-accent transition"
      onDoubleClick={() => {
        setDraft(token.name);
        setEditing(true);
      }}
      title="Double-click to rename (references follow)"
    >
      {token.name}
    </button>
  );
}

function NewTokenRow({
  collection,
  onDone,
}: {
  collection: CollectionDoc;
  onDone: () => void;
}) {
  const actions = useActions();
  const [name, setName] = useState("");
  const [type, setType] = useState<TokenType>("color");
  const [value, setValue] = useState("");

  const create = async () => {
    if (!name.trim() || !value.trim()) return;
    const values = Object.fromEntries(
      collection.modes.map((m) => [
        m,
        { type: "raw" as const, value: value.trim() },
      ])
    );
    try {
      await actions.createToken({
        collection: collection.name,
        token: { name: name.trim(), type, values },
      });
      onDone();
    } catch (err) {
      alert(String((err as Error).message));
    }
  };

  return (
    <tr>
      <td className="py-1.5 pr-4" colSpan={1 + collection.modes.length}>
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            placeholder="group.token-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-7 w-56 font-mono text-xs"
            onKeyDown={(e) => e.key === "Enter" && void create()}
          />
          <Select value={type} onValueChange={(t) => setType(t as TokenType)}>
            <SelectTrigger className="h-7 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["color", "dimension", "number", "string"] as const).map(
                (t) => (
                  <SelectItem key={t} value={t} className="text-xs">
                    {t}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
          <Input
            placeholder={type === "color" ? "#3b82f6" : "value"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-7 w-40 font-mono text-xs"
            onKeyDown={(e) => e.key === "Enter" && void create()}
          />
          <Button size="sm" className="h-7" onClick={() => void create()}>
            Add
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </td>
    </tr>
  );
}

export function TokenTableView({
  collection,
  filterGroup = null,
  autoFocusToken = null,
}: {
  collection: CollectionDoc;
  /** Show only tokens under this dotted prefix (from GroupsNav). */
  filterGroup?: string | null;
  /** Token name to open in rename mode (just-created tokens). */
  autoFocusToken?: string | null;
}) {
  const actions = useActions();
  const [adding, setAdding] = useState(false);

  const visibleTokens = useMemo(
    () =>
      filterGroup
        ? collection.tokens.filter(
            (t) => t.name === filterGroup || t.name.startsWith(`${filterGroup}.`)
          )
        : collection.tokens,
    [collection.tokens, filterGroup]
  );

  // Group by first dotted segment; honor groupOrder, then discovery order.
  const groups = useMemo(() => {
    const byGroup = new Map<string, TokenDoc[]>();
    for (const t of visibleTokens) {
      const g = groupOf(t.name);
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(t);
    }
    const order = [
      ...(collection.groupOrder ?? []),
      ...[...byGroup.keys()].filter(
        (g) => !(collection.groupOrder ?? []).includes(g)
      ),
    ];
    return order
      .filter((g) => byGroup.has(g))
      .map((g) => ({ group: g, tokens: byGroup.get(g)! }));
  }, [collection, visibleTokens]);

  return (
    <div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="border-b py-1.5 pr-4 font-medium">Token</th>
            {collection.modes.map((m) => (
              <th key={m} className="border-b py-1.5 pr-4 font-medium">
                {m}
              </th>
            ))}
            <th className="w-8 border-b" />
          </tr>
        </thead>
        <tbody>
          {groups.map(({ group, tokens }) => (
            <GroupRows
              key={group || "(root)"}
              group={group}
              tokens={tokens}
              collection={collection}
              autoFocusToken={autoFocusToken}
              onRemove={(name) => void actions.removeToken({ name })}
            />
          ))}
          {adding && (
            <NewTokenRow collection={collection} onDone={() => setAdding(false)} />
          )}
        </tbody>
      </table>
      {!adding && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-7 text-xs text-muted-foreground"
          onClick={() => setAdding(true)}
        >
          <Plus className="h-3 w-3" /> Add token
        </Button>
      )}
    </div>
  );
}

function GroupRows({
  group,
  tokens,
  collection,
  autoFocusToken,
  onRemove,
}: {
  group: string;
  tokens: TokenDoc[];
  collection: CollectionDoc;
  autoFocusToken?: string | null;
  onRemove: (name: string) => void;
}) {
  return (
    <>
      {group && (
        <tr>
          <td
            colSpan={2 + collection.modes.length}
            className="pt-3 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            {group}
          </td>
        </tr>
      )}
      {tokens.map((t) => (
        <tr key={t.name} className="align-middle">
          <td className="border-b border-neutral-100 py-1 pr-4 dark:border-neutral-800">
            <TokenNameCell token={t} autoFocus={t.name === autoFocusToken} />
          </td>
          {collection.modes.map((mode) => (
            <td
              key={mode}
              className="border-b border-neutral-100 py-1 pr-4 dark:border-neutral-800"
            >
              <ValueCell token={t} mode={mode} />
            </td>
          ))}
          <td className="border-b border-neutral-100 py-1 text-right dark:border-neutral-800">
            {!t.generated && (
              <DropdownMenu>
                <DropdownMenuTrigger className="rounded p-1 opacity-0 transition hover:bg-accent [tr:hover_&]:opacity-100">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    variant="destructive"
                    className="text-xs"
                    onClick={() => {
                      if (confirm(`Delete token "${t.name}"?`)) onRemove(t.name);
                    }}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </td>
        </tr>
      ))}
    </>
  );
}
