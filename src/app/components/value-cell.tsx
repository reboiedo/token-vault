/**
 * ValueCell — cloud-parity cell (port of web/src/components/value-cell.tsx):
 *
 *   raw color      swatch + hex + computed OKLCH second line
 *   raw string     quoted "value"
 *   alias          purple pill {name} · Unlink · Revert
 *   tailwind       cyan pill tw:color · Unlink · Revert
 *   derived        amber pill (Sparkles) base · N ops → DerivationEditor
 *   expression     amber pill formula = Npx → ExpressionEditor
 *   composite      Aa + per-slot pills (popover per slot, type-filtered);
 *                  layered composites show an "N layers" badge
 *
 * Non-base modes without their own value render INHERITED (50% opacity,
 * click to override); with their own value they get a Revert-to-base
 * (Undo2) that deletes the mode key. The link picker groups alias
 * options by collection with resolved-value previews, pins Derive
 * (color) / Expression (dimension|number), and offers Tailwind families.
 */

import { useMemo, useState } from "react";
import { Link as LinkIcon, Lock, Sigma, Sparkles, Undo2, Unlink } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { ColorPickerPopover } from "./color-picker-popover";
import { TailwindColorCommandGroup } from "./tailwind-color-picker";
import { DerivationEditor } from "./derivation-editor";
import { ExpressionEditor, rawToPx } from "./expression-editor";
import { getTailwindHex } from "@core/tailwind-colors";
import { hexToOklch } from "@core/color-utils";
import { resolveExpressionToNumber } from "@core/expression";
import type { CompositeLayer, TokenDoc, TokenType, TokenValue } from "@core/types";
import { useActions, useCollections, useSystem } from "@/lib/store";
import { useResolver } from "@/lib/resolver";
import { cn } from "@/lib/utils";

// Slot → allowed token types, from the cloud's value-cell.
const SLOT_ORDER = ["fontFamily", "fontSize", "fontWeight", "letterSpacing", "lineHeight"];
const SLOT_ALLOWED_TYPES: Record<string, TokenType[]> = {
  fontFamily: ["fontFamily", "string"],
  fontSize: ["dimension", "number"],
  fontWeight: ["fontWeight", "number"],
  letterSpacing: ["dimension", "number"],
  lineHeight: ["number", "dimension"],
  duration: ["duration"],
  delay: ["duration"],
  timingFunction: ["cubicBezier"],
  color: ["color"],
};

function oklchLine(hex: string): string | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const { l, c, h } = hexToOklch(hex);
  return `oklch(${(l * 100).toFixed(1)}% ${c.toFixed(3)} ${h.toFixed(1)})`;
}

/** Alias options grouped by collection, with resolved previews. */
function useGroupedAliasOptions(mode: string, selfName: string) {
  const collections = useCollections();
  const resolver = useResolver();
  return useMemo(
    () =>
      collections
        .map((c) => ({
          collection: c.name,
          options: c.tokens
            .filter((t) => t.name !== selfName)
            .map((t) => ({
              name: t.name,
              type: t.type,
              preview:
                t.minPx !== undefined && t.maxPx !== undefined
                  ? `${t.minPx}→${t.maxPx}px`
                  : resolver.resolveRaw(t.name, mode) ?? "",
            })),
        }))
        .filter((g) => g.options.length > 0),
    [collections, resolver, mode, selfName]
  );
}

// ============================================================================
// COMPOSITE PILLS
// ============================================================================

function CompositeSlotPill({
  slot,
  layer,
  mode,
  selfName,
  onSlotChange,
}: {
  slot: string;
  layer: CompositeLayer;
  mode: string;
  selfName: string;
  onSlotChange: (slot: string, next: CompositeLayer[string]) => void;
}) {
  const [open, setOpen] = useState(false);
  const groups = useGroupedAliasOptions(mode, selfName);
  const value = layer[slot];
  const allowed = SLOT_ALLOWED_TYPES[slot];
  const label =
    value === undefined
      ? "—"
      : value.type === "alias"
        ? value.token
        : String(value.value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "max-w-28 truncate rounded px-1 py-0.5 font-mono text-[10px] transition hover:bg-accent",
          value?.type === "alias"
            ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
            : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
        )}
        title={`${slot}: ${label}`}
      >
        {label}
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Link ${slot} to a token…`} />
          <CommandList>
            <CommandEmpty>No compatible tokens.</CommandEmpty>
            {groups.map((g) => {
              const compatible = g.options
                .filter((o) => !allowed || !o.type || allowed.includes(o.type))
                .sort((a, b) => {
                  const ap = a.name.startsWith(slot) ? 0 : 1;
                  const bp = b.name.startsWith(slot) ? 0 : 1;
                  return ap - bp || a.name.localeCompare(b.name);
                });
              if (!compatible.length) return null;
              return (
                <CommandGroup key={g.collection} heading={g.collection}>
                  {compatible.map((o) => (
                    <CommandItem
                      key={o.name}
                      value={o.name}
                      className="text-xs"
                      onSelect={() => {
                        onSlotChange(slot, { type: "alias", token: o.name });
                        setOpen(false);
                      }}
                    >
                      <span className="truncate font-mono">{o.name}</span>
                      {o.preview && (
                        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                          {o.preview}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ============================================================================
// MAIN CELL
// ============================================================================

export function ValueCell({
  token,
  mode,
  baseMode,
}: {
  token: TokenDoc;
  mode: string;
  /** First mode of the collection — inheritance source. */
  baseMode?: string;
}) {
  const actions = useActions();
  const system = useSystem();
  const resolver = useResolver();
  const [menuOpen, setMenuOpen] = useState(false);
  const [deriving, setDeriving] = useState(false);
  const [expressing, setExpressing] = useState(false);
  const [rawDraft, setRawDraft] = useState<string | null>(null);
  const groups = useGroupedAliasOptions(mode, token.name);

  const own: TokenValue | undefined = token.values[mode];
  const base = baseMode ? token.values[baseMode] : undefined;
  const inherited = !own && !!base && mode !== baseMode;
  const value = own ?? base;
  const isColor = token.type === "color";

  const resolvedRaw = resolver.resolveRaw(token.name, mode);
  const resolvedHex = resolvedRaw?.startsWith("#") ? resolvedRaw : null;

  const write = (next: TokenValue) =>
    actions.updateToken({
      name: token.name,
      values: { ...token.values, [mode]: next },
    });

  const revertToBase = () => {
    const { [mode]: _, ...rest } = token.values;
    return actions.updateToken({ name: token.name, values: rest });
  };

  const unlink = () => {
    if (resolvedRaw) void write({ type: "raw", value: resolvedRaw });
  };

  // ---- read-only (generated) ------------------------------------------
  if (token.generated) {
    const label = value?.type === "raw" ? String(value.value) : value ? value.type : "—";
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
        {resolvedHex && (
          <span className="h-3.5 w-3.5 shrink-0 rounded border" style={{ background: resolvedHex }} />
        )}
        <span className="truncate">{label}</span>
        <Lock className="h-3 w-3 opacity-40" />
      </span>
    );
  }

  // ---- composite -------------------------------------------------------
  if (value?.type === "composite") {
    if (Array.isArray(value.layers)) {
      return (
        <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
          {value.layers.length} layer(s)
        </span>
      );
    }
    const layer = value.layers;
    const slots = [
      ...SLOT_ORDER.filter((s) => s in layer),
      ...Object.keys(layer).filter((s) => !SLOT_ORDER.includes(s)),
    ];
    return (
      <span className={cn("flex min-w-0 flex-wrap items-center gap-1", inherited && "opacity-50")}>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">Aa</span>
        {slots.map((slot) => (
          <CompositeSlotPill
            key={slot}
            slot={slot}
            layer={layer}
            mode={mode}
            selfName={token.name}
            onSlotChange={(s, next) =>
              void write({ type: "composite", layers: { ...layer, [s]: next } })
            }
          />
        ))}
        {!inherited && mode !== baseMode && own && (
          <RevertButton onClick={() => void revertToBase()} />
        )}
      </span>
    );
  }

  // ---- pills -----------------------------------------------------------
  const expressionPx =
    value?.type === "expression"
      ? resolveExpressionToNumber(value.formula, (ref) => rawToPx(resolver.resolveRaw(ref, mode)))
      : null;

  const chip = (() => {
    if (!value) return <span className="text-neutral-300 dark:text-neutral-600">—</span>;
    switch (value.type) {
      case "raw": {
        const s = String(value.value);
        const isStr = token.type === "string" || token.type === "fontFamily";
        return (
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{isStr ? `"${s}"` : s}</span>
            {isColor && oklchLine(s) && (
              <span className="truncate text-[9px] text-muted-foreground">{oklchLine(s)}</span>
            )}
          </span>
        );
      }
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
      case "derived": {
        const b = value.base;
        const baseLabel = b.kind === "token" ? b.token : b.kind === "tailwind" ? `tw:${b.color}` : b.value;
        return (
          <span className="inline-flex min-w-0 items-center gap-1 truncate rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            <Sparkles className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {baseLabel}
              {value.ops.length > 0 && ` · ${value.ops.length} op${value.ops.length > 1 ? "s" : ""}`}
            </span>
          </span>
        );
      }
      case "expression":
        return (
          <span className="inline-flex min-w-0 items-center gap-1 truncate rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            <Sigma className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {value.formula}
              {expressionPx !== null && ` = ${Math.round(expressionPx * 100) / 100}px`}
            </span>
          </span>
        );
      default:
        return null;
    }
  })();

  const swatchHex = value?.type === "tailwind" ? getTailwindHex(value.color) : resolvedHex;
  const linked = value && value.type !== "raw";

  return (
    <>
      <span
        className={cn("inline-flex min-w-0 max-w-full items-center gap-1.5 font-mono text-xs", inherited && "opacity-50")}
        title={inherited ? "Inherited from the base mode — set a value to override" : resolvedRaw ?? undefined}
      >
        {isColor && value?.type === "raw" && !inherited ? (
          <ColorPickerPopover
            value={String(value.value)}
            onChange={(hex) => void write({ type: "raw", value: hex })}
            swatchClassName="h-4 w-4"
          />
        ) : (
          swatchHex && (
            <span className="h-3.5 w-3.5 shrink-0 rounded border" style={{ background: swatchHex }} />
          )
        )}

        {value?.type === "derived" && !inherited ? (
          <button type="button" className="min-w-0 truncate text-left" onClick={() => setDeriving(true)}>
            {chip}
          </button>
        ) : value?.type === "expression" && !inherited ? (
          <button type="button" className="min-w-0 truncate text-left" onClick={() => setExpressing(true)}>
            {chip}
          </button>
        ) : (
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger className="min-w-0 truncate rounded px-1 py-0.5 text-left transition hover:bg-accent">
              {chip}
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="start">
              <Command>
                <div className="flex items-center gap-1.5 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                  <LinkIcon className="h-3 w-3" /> Link to token
                </div>
                <CommandInput placeholder="Search tokens or set a value…" />
                <CommandList>
                  <CommandEmpty>No matches.</CommandEmpty>
                  <CommandGroup heading="Set value">
                    <div className="flex items-center gap-1.5 px-2 pb-1.5">
                      <Input
                        className="h-7 font-mono text-xs"
                        placeholder={value?.type === "raw" ? String(value.value) : "raw value"}
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
                    {isColor && (
                      <CommandItem
                        value="__derive"
                        className="text-xs"
                        onSelect={() => {
                          setMenuOpen(false);
                          setDeriving(true);
                        }}
                      >
                        <Sparkles className="h-3 w-3" />
                        <span className="ml-1">
                          {value?.type === "derived" ? "Edit derivation" : "Derive from another…"}
                        </span>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          lighten / mute / mix
                        </span>
                      </CommandItem>
                    )}
                    {(token.type === "dimension" || token.type === "number") && (
                      <CommandItem
                        value="__expression"
                        className="text-xs"
                        onSelect={() => {
                          setMenuOpen(false);
                          setExpressing(true);
                        }}
                      >
                        <Sigma className="h-3 w-3" />
                        <span className="ml-1">
                          {value?.type === "expression" ? "Edit expression" : "Expression…"}
                        </span>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          e.g. container * 0.875
                        </span>
                      </CommandItem>
                    )}
                  </CommandGroup>
                  <CommandSeparator />
                  {groups.map((g) => (
                    <CommandGroup key={g.collection} heading={g.collection}>
                      {g.options.map((o) => (
                        <CommandItem
                          key={o.name}
                          value={o.name}
                          className="text-xs"
                          onSelect={() => {
                            void write({ type: "alias", token: o.name });
                            setMenuOpen(false);
                          }}
                        >
                          {o.preview.startsWith("#") && (
                            <span className="h-3 w-3 shrink-0 rounded border" style={{ background: o.preview }} />
                          )}
                          <span className="ml-1 truncate font-mono">{o.name}</span>
                          {o.preview && (
                            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                              {o.preview.length > 18 ? `${o.preview.slice(0, 18)}…` : o.preview}
                            </span>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
                  {system?.useTailwindColors && isColor && (
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
        )}

        {/* hover actions */}
        {linked && !inherited && (
          <button
            type="button"
            className="rounded p-0.5 opacity-0 transition hover:bg-accent group-hover/row:opacity-100"
            title="Unlink (freeze the resolved value)"
            onClick={unlink}
          >
            <Unlink className="h-3 w-3" />
          </button>
        )}
        {mode !== baseMode && own && (
          <RevertButton onClick={() => void revertToBase()} />
        )}
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
          onSave={(b, ops) => write({ type: "derived", base: b, ops })}
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

function RevertButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="rounded p-0.5 opacity-0 transition hover:bg-accent group-hover/row:opacity-100"
      title="Revert to base mode value"
      onClick={onClick}
    >
      <Undo2 className="h-3 w-3" />
    </button>
  );
}
