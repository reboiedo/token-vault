/**
 * ValueCell — one (token, mode) cell of the table. Displays the value
 * by variant and hosts the editing affordances:
 *
 *   raw          swatch + text (color picker / text input)
 *   alias        purple chip  {token.name}
 *   tailwind     cyan chip    tw:slate-500
 *   derived      amber chip   → DerivationEditor
 *   expression   `= formula`  → ExpressionEditor
 *   composite    neutral chip (read-only in v1 — edit via MCP/files)
 *
 * Generated tokens render read-only. Writes go through
 * `actions.updateToken` with the token's full per-mode value map.
 */

import { useMemo, useState } from "react";
import { Lock, Sigma, Sparkles } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { ColorPickerPopover } from "./color-picker-popover";
import { TailwindColorCommandGroup } from "./tailwind-color-picker";
import { DerivationEditor } from "./derivation-editor";
import { ExpressionEditor } from "./expression-editor";
import { getTailwindHex } from "@core/tailwind-colors";
import type { TokenDoc, TokenValue } from "@core/types";
import { useActions, useSystem } from "@/lib/store";
import { useResolver } from "@/lib/resolver";
import { cn } from "@/lib/utils";

export function ValueCell({
  token,
  mode,
}: {
  token: TokenDoc;
  mode: string;
}) {
  const actions = useActions();
  const system = useSystem();
  const resolver = useResolver();
  const [menuOpen, setMenuOpen] = useState(false);
  const [deriving, setDeriving] = useState(false);
  const [expressing, setExpressing] = useState(false);
  const [rawDraft, setRawDraft] = useState<string | null>(null);

  const value: TokenValue | undefined = token.values[mode];
  const isColor = token.type === "color";
  const resolvedHex = useMemo(() => {
    const raw = resolver.resolveRaw(token.name, mode);
    return raw?.startsWith("#") ? raw : null;
  }, [resolver, token.name, mode]);

  const write = (next: TokenValue) =>
    actions.updateToken({
      name: token.name,
      values: { ...token.values, [mode]: next },
    });

  // --------------------------------------------------------------------
  // Read-only rendering (generated tokens)
  // --------------------------------------------------------------------
  if (token.generated) {
    const label =
      value?.type === "raw" ? String(value.value) : value ? value.type : "—";
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
        {resolvedHex && (
          <span
            className="h-3.5 w-3.5 rounded border shrink-0"
            style={{ background: resolvedHex }}
          />
        )}
        <span className="truncate">{label}</span>
        <Lock className="h-3 w-3 opacity-40" />
      </span>
    );
  }

  // --------------------------------------------------------------------
  // Display chip per variant
  // --------------------------------------------------------------------
  const chip = (() => {
    if (!value)
      return <span className="text-neutral-300 dark:text-neutral-600">—</span>;
    switch (value.type) {
      case "raw":
        return <span className="truncate">{String(value.value)}</span>;
      case "alias":
        return (
          <span className="truncate rounded bg-purple-100 px-1.5 py-0.5 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
            {`{${value.token}}`}
          </span>
        );
      case "tailwind":
        return (
          <span className="truncate rounded bg-cyan-100 px-1.5 py-0.5 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300">
            tw:{value.color}
          </span>
        );
      case "derived":
        return (
          <span className="inline-flex items-center gap-1 truncate rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            <Sparkles className="h-3 w-3" />
            derived{value.ops.length ? ` +${value.ops.length}` : ""}
          </span>
        );
      case "expression":
        return (
          <span className="inline-flex items-center gap-1 truncate">
            <Sigma className="h-3 w-3 text-muted-foreground" />
            {value.formula}
          </span>
        );
      case "composite":
        return (
          <span className="truncate rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            composite
            {Array.isArray(value.layers) ? ` ×${value.layers.length}` : ""}
          </span>
        );
    }
  })();

  const swatchHex =
    value?.type === "tailwind"
      ? getTailwindHex(value.color)
      : resolvedHex;

  return (
    <>
      <span className="inline-flex min-w-0 items-center gap-1.5 font-mono text-xs">
        {isColor && value?.type === "raw" ? (
          <ColorPickerPopover
            value={String(value.value)}
            onChange={(hex) => write({ type: "raw", value: hex })}
            swatchClassName="h-4 w-4"
          />
        ) : (
          swatchHex && (
            <span
              className="h-3.5 w-3.5 shrink-0 rounded border"
              style={{ background: swatchHex }}
            />
          )
        )}
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger
            className={cn(
              "min-w-0 truncate rounded px-1 py-0.5 text-left hover:bg-accent transition"
            )}
            title={token.name}
          >
            {chip}
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search tokens or set a value…" />
              <CommandList>
                <CommandEmpty>No matches.</CommandEmpty>
                <CommandGroup heading="Set value">
                  <div className="flex items-center gap-1.5 px-2 pb-1.5">
                    <Input
                      className="h-7 font-mono text-xs"
                      placeholder={
                        value?.type === "raw" ? String(value.value) : "raw value"
                      }
                      value={rawDraft ?? ""}
                      onChange={(e) => setRawDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && rawDraft?.trim()) {
                          void write({ type: "raw", value: rawDraft.trim() });
                          setRawDraft(null);
                          setMenuOpen(false);
                        }
                      }}
                    />
                  </div>
                  <CommandItem
                    value="__derive"
                    onSelect={() => {
                      setMenuOpen(false);
                      setDeriving(true);
                    }}
                    className="text-xs"
                  >
                    <Sparkles className="h-3 w-3" />
                    <span className="ml-1">Derive from other tokens…</span>
                  </CommandItem>
                  <CommandItem
                    value="__expression"
                    onSelect={() => {
                      setMenuOpen(false);
                      setExpressing(true);
                    }}
                    className="text-xs"
                  >
                    <Sigma className="h-3 w-3" />
                    <span className="ml-1">Expression…</span>
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading="Link token">
                  {resolver
                    .aliasOptions([mode])
                    .filter((o) => o.name !== token.name)
                    .map((o) => (
                      <CommandItem
                        key={o.name}
                        value={o.name}
                        onSelect={() => {
                          void write({ type: "alias", token: o.name });
                          setMenuOpen(false);
                        }}
                        className="text-xs"
                      >
                        {o.resolvedValue?.startsWith("#") && (
                          <span
                            className="h-3 w-3 rounded border shrink-0"
                            style={{ background: o.resolvedValue }}
                          />
                        )}
                        <span className="ml-1 truncate font-mono">{o.name}</span>
                      </CommandItem>
                    ))}
                </CommandGroup>
                {system?.useTailwindColors && (
                  <TailwindColorCommandGroup
                    onSelect={(color) => {
                      void write({ type: "tailwind", color });
                      setMenuOpen(false);
                    }}
                  />
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </span>

      {deriving && (
        <DerivationEditor
          open={deriving}
          onOpenChange={setDeriving}
          initial={
            value?.type === "derived"
              ? { base: value.base, ops: value.ops }
              : {
                  base:
                    value?.type === "alias"
                      ? { kind: "token", token: value.token }
                      : { kind: "raw", value: resolvedHex ?? "#3b82f6" },
                  ops: [],
                }
          }
          onSave={(base, ops) => write({ type: "derived", base, ops })}
        />
      )}
      {expressing && (
        <ExpressionEditor
          open={expressing}
          onOpenChange={setExpressing}
          initialFormula={value?.type === "expression" ? value.formula : ""}
          onSave={(formula) => write({ type: "expression", formula })}
        />
      )}
    </>
  );
}
