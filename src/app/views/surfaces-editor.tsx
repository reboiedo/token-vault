/**
 * SurfacesEditorView — full-fidelity port of the cloud product's
 * surfaces editor (web/src/components/surfaces-editor.tsx), name-based.
 *
 * Sections, matching the cloud UI:
 *   1. Surfaces table — rows × modes. Per cell: base editor (raw hex
 *      swatch / alias / tailwind / DERIVED via the derivation editor,
 *      with unlink-freeze and reset-to-inherited on non-primary modes)
 *      and the unified fg picker (auto with resolved hint / light /
 *      dark / token / tailwind). Mode headers rename + reorder.
 *      Per-surface menu: materialize base, bare levels (with >1-bare
 *      warning), delete.
 *   2. Levels — rule rows with kind picker (fg / surface variation /
 *      ink mix / opacity / scale step) and BOTH branch columns
 *      (light-mode / dark-mode) linked by default: editing Light
 *      mirrors into Dark until unlinked. Live previews + APCA Lc
 *      readouts against a selectable preview surface; fg rules carry
 *      target (APCA Lc / mix), anchor and measure-against; shifts use
 *      the Lightroom-style signed slider + ΔC + mix-with; opacity has
 *      α + true-alpha/flatten bake; scale-step picks a step + scale
 *      source (parent / token scale / tailwind family).
 *   3. Surface × level matrix — per-cell on/off (levelStates).
 *   4. Preview — live client-side materialization of the DRAFT.
 */

import { Fragment, useMemo, useState } from "react";
import {
  Blend,
  ChevronDown,
  ChevronUp,
  Contrast,
  Droplet,
  Layers,
  Link2,
  Link2Off,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Type as TypeIcon,
  Unlink,
} from "lucide-react";
import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ColorPickerPopover } from "@/components/color-picker-popover";
import {
  TailwindColorCommandGroup,
  TailwindColorPopover,
} from "@/components/tailwind-color-picker";
import { DerivationEditor } from "@/components/derivation-editor";
import {
  computeCellHex,
  effectiveLevelRule,
  expandSurfaceModes,
  generateSurfaceTokens,
  getMeasureAgainst,
  makeResolveScaleStep,
  modeKeyPrimary,
  normalizeFgTarget,
  resolveMeasureBackdropHex,
  resolveSurfaceBaseHex,
  withAlpha,
  type SurfaceBaseValue,
  type SurfaceFgChoice,
  type SurfaceLevel,
  type SurfaceLevelAnchor,
  type SurfaceLevelBranch,
  type SurfaceLevelRule,
  type SurfaceMeasureRef,
  type SurfaceMixBranch,
  type SurfaceOpacityBranch,
  type SurfaceOpacitySource,
  type SurfaceRow,
  type SurfaceScaleStepBranch,
  type SurfaceShiftBranch,
  type SurfacesConfig,
  WILDCARD_LEVEL_KEY,
} from "@core/surfaces-utils";
import { apcaLc } from "@core/apca-utils";
import { hexToOklch } from "@core/color-utils";
import { getTailwindHex, TAILWIND_FAMILY_NAMES } from "@core/tailwind-colors";
import type { CollectionDoc } from "@core/types";
import { useActions, useSystem } from "@/lib/store";
import { useResolver } from "@/lib/resolver";
import { cn } from "@/lib/utils";

const uid = () => Math.random().toString(36).slice(2, 10);
const DEFAULT_THRESHOLD = 0.6;

type ResolveBaseHex = (ref: string, mode?: string) => string | null;
type ChannelBranch =
  | SurfaceLevelBranch
  | SurfaceShiftBranch
  | SurfaceMixBranch
  | SurfaceOpacityBranch
  | SurfaceScaleStepBranch;

// ============================================================================
// SEEDS — mirror the cloud's seedSurfacesConfig / default*Level
// ============================================================================

function seedConfig(modes: string[]): SurfacesConfig {
  const [first, second] = modes;
  const base: Record<string, SurfaceBaseValue> = {};
  if (first) base[first] = { kind: "raw", value: "#ffffff" };
  if (second) base[second] = { kind: "raw", value: "#0a0a0a" };
  const fg = (lc: number): SurfaceLevelRule => ({
    kind: "fg",
    onLight: { target: { kind: "apca", lc }, anchor: { kind: "auto" } },
    onDark: { target: { kind: "apca", lc }, anchor: { kind: "auto" } },
  });
  return {
    contrastThreshold: DEFAULT_THRESHOLD,
    surfaces: [
      {
        id: uid(),
        name: "bg",
        materializeBase: true,
        bareLevels: true,
        baseByMode: base,
      },
    ],
    levels: [
      { id: uid(), name: "fg", rule: fg(90) },
      { id: uid(), name: "fg-muted", rule: fg(60) },
      { id: uid(), name: "fg-disabled", rule: fg(30) },
      { id: uid(), name: "border", display: "separator", rule: fg(18) },
    ],
  };
}

const RULE_KIND_LABELS: Record<SurfaceLevelRule["kind"], string> = {
  fg: "Foreground",
  "surface-shift": "Surface variation",
  "surface-mix": "Ink mix",
  opacity: "Opacity",
  "scale-step": "Scale step",
};

function defaultRuleForKind(kind: SurfaceLevelRule["kind"]): SurfaceLevelRule {
  switch (kind) {
    case "fg":
      return {
        kind,
        onLight: { target: { kind: "apca", lc: 75 }, anchor: { kind: "auto" } },
        onDark: { target: { kind: "apca", lc: 75 }, anchor: { kind: "auto" } },
      };
    case "surface-shift":
      return { kind, onLight: { stepStrength: 0.4 }, onDark: { stepStrength: 0.4 } };
    case "surface-mix":
      return {
        kind,
        onLight: { mix: 0.6, anchor: { kind: "auto" } },
        onDark: { mix: 0.6, anchor: { kind: "auto" } },
      };
    case "opacity":
      return {
        kind,
        source: "fg",
        bake: "alpha",
        onLight: { alpha: 0.4 },
        onDark: { alpha: 0.4 },
      };
    case "scale-step":
      return { kind, onLight: { step: "100" }, onDark: { step: "900" } };
  }
}

function defaultLevelForKind(kind: SurfaceLevelRule["kind"]): SurfaceLevel {
  const names: Record<SurfaceLevelRule["kind"], string> = {
    fg: "level",
    "surface-shift": "hover",
    "surface-mix": "mix",
    opacity: "disabled",
    "scale-step": "soft",
  };
  const displays: Partial<Record<SurfaceLevelRule["kind"], SurfaceLevel["display"]>> =
    { "surface-shift": "bg", "surface-mix": "bg", "scale-step": "bg" };
  return {
    id: uid(),
    name: names[kind],
    ...(displays[kind] ? { display: displays[kind] } : {}),
    rule: defaultRuleForKind(kind),
  };
}

// ============================================================================
// SIGNED SLIDER — Lightroom-style: plain track, ruler ticks, big zero
// mark, no fill (a negative value must not look positive). Port of the
// cloud's Radix version onto Base UI slider parts.
// ============================================================================

function SignedSlider({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const tickCount = 9;
  const ticks = Array.from(
    { length: tickCount },
    (_, i) => (i / (tickCount - 1)) * 100
  );
  const zeroPct = ((0 - min) / (max - min)) * 100;

  return (
    <SliderPrimitive.Root
      min={min}
      max={max}
      step={step}
      value={value}
      onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
      className="w-full"
    >
      <SliderPrimitive.Control className="relative flex h-4 w-full touch-none items-center select-none">
        <SliderPrimitive.Track className="relative h-px grow bg-muted-foreground/40">
          {ticks.map((pct) => (
            <div
              key={pct}
              className="pointer-events-none absolute top-1/2 h-1.5 w-px -translate-y-1/2 bg-muted-foreground/30"
              style={{ left: `${pct}%` }}
              aria-hidden
            />
          ))}
          <div
            className="pointer-events-none absolute top-1/2 h-3 w-px -translate-y-1/2 bg-muted-foreground/70"
            style={{ left: `${zeroPct}%` }}
            aria-hidden
          />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="block h-3 w-3 rounded-full border border-primary bg-background shadow-sm hover:bg-accent" />
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const isSigned = min < 0 && max > 0;
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="w-7 shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">
        {isSigned ? (
          <SignedSlider value={value} min={min} max={max} step={step} onChange={onChange} />
        ) : (
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="w-full"
          />
        )}
      </div>
      <code className="w-12 shrink-0 text-right tabular-nums">{format(value)}</code>
    </div>
  );
}

// ============================================================================
// TOKEN COMMAND GROUP — shared alias options list for pickers
// ============================================================================

function TokenCommandGroup({
  heading = "Tokens",
  mode,
  onSelect,
}: {
  heading?: string;
  mode?: string;
  onSelect: (name: string) => void;
}) {
  const resolver = useResolver();
  const options = useMemo(
    () => resolver.aliasOptions(mode ? [mode] : []),
    [resolver, mode]
  );
  return (
    <CommandGroup heading={heading}>
      {options.map((o) => {
        const hex = (mode && o.resolvedByMode?.[mode]) ?? o.resolvedValue;
        return (
          <CommandItem
            key={o.name}
            value={o.name}
            onSelect={() => onSelect(o.name)}
            className="text-xs"
          >
            {hex?.startsWith("#") && (
              <span
                className="h-3 w-3 shrink-0 rounded border"
                style={{ background: hex }}
              />
            )}
            <span className="ml-1 truncate font-mono">{o.name}</span>
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}

// ============================================================================
// MODE HEADER — rename + reorder (persists immediately via actions)
// ============================================================================

function ModeHeader({
  name,
  index,
  total,
  collection,
}: {
  name: string;
  index: number;
  total: number;
  collection: CollectionDoc;
}) {
  const actions = useActions();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  const move = (dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= total) return;
    const next = [...collection.modes];
    [next[index], next[target]] = [next[target], next[index]];
    void actions.reorderModes({ collection: collection.name, modes: next });
  };

  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 opacity-30 hover:opacity-100 disabled:opacity-10"
        disabled={index === 0}
        onClick={() => move(-1)}
      >
        ◀
      </Button>
      {editing ? (
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={async (e) => {
            if (e.key === "Escape") setEditing(false);
            if (e.key === "Enter") {
              setEditing(false);
              const next = draft.trim();
              if (next && next !== name) {
                try {
                  await actions.renameMode({
                    collection: collection.name,
                    oldName: name,
                    newName: next,
                  });
                } catch (err) {
                  alert(String((err as Error).message));
                }
              }
            }
          }}
          className="h-6 w-20 text-xs"
        />
      ) : (
        <button
          type="button"
          className="rounded px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:bg-accent"
          onDoubleClick={() => name !== "default" && setEditing(true)}
          title={name === "default" ? undefined : "Double-click to rename"}
        >
          {name}
          {index === 0 && (
            <span className="ml-1 text-[9px] normal-case opacity-60">primary</span>
          )}
        </button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 opacity-30 hover:opacity-100 disabled:opacity-10"
        disabled={index === total - 1}
        onClick={() => move(1)}
      >
        ▶
      </Button>
    </div>
  );
}

// ============================================================================
// SURFACE BASE CELL — raw / alias / tailwind / derived, with unlink and
// reset-to-inherited. Mirrors the cloud's SurfaceBaseCell.
// ============================================================================

function BaseCell({
  value,
  mode,
  inherited,
  resolveBaseHex,
  onChange,
  onReset,
}: {
  value: SurfaceBaseValue | undefined;
  mode: string;
  /** Non-primary mode showing the primary's value — rendered dimmed. */
  inherited: boolean;
  resolveBaseHex: ResolveBaseHex;
  onChange: (next: SurfaceBaseValue) => void;
  onReset?: () => void;
}) {
  const system = useSystem();
  const [open, setOpen] = useState(false);
  const [deriving, setDeriving] = useState(false);

  const resolvedHex =
    resolveSurfaceBaseHex(value, mode, resolveBaseHex) ?? "#ffffff";
  const isAlias = value?.kind === "alias";
  const isDerived = value?.kind === "derived";

  const derivedSummary = (() => {
    if (value?.kind !== "derived") return null;
    const b = value.base;
    const baseName =
      b.kind === "token" ? b.token : b.kind === "tailwind" ? `tw:${b.color}` : b.value;
    return value.ops.length ? `${baseName} +${value.ops.length}` : baseName;
  })();

  return (
    <div
      className={cn("group flex min-w-0 flex-1 items-center gap-1", inherited && "opacity-45")}
      title={inherited ? "Inherited from the primary mode — edit to override" : undefined}
    >
      <ColorPickerPopover
        value={resolvedHex}
        onChange={(next) => onChange({ kind: "raw", value: next })}
        swatchClassName="h-6 w-6"
      />
      {isDerived ? (
        <button
          type="button"
          onClick={() => setDeriving(true)}
          className="h-7 min-w-0 flex-1 truncate rounded bg-amber-100 px-1.5 text-left font-mono text-xs text-amber-700 transition hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300"
          title={`${derivedSummary} · ${resolvedHex}`}
        >
          <Sparkles className="mr-1 -mt-0.5 inline h-3 w-3" />
          {derivedSummary}
        </button>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            className={cn(
              "h-7 min-w-0 flex-1 truncate rounded px-1.5 text-left font-mono text-xs transition hover:bg-accent",
              isAlias &&
                "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
            )}
            title={isAlias && value?.kind === "alias" ? `→ ${value.token} · ${resolvedHex}` : resolvedHex}
          >
            {isAlias && value?.kind === "alias" ? value.token : resolvedHex}
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search color tokens…" />
              <CommandList>
                <CommandEmpty>No tokens found.</CommandEmpty>
                <CommandGroup heading="Behaviour">
                  <CommandItem
                    value="__derive"
                    onSelect={() => {
                      setOpen(false);
                      setDeriving(true);
                    }}
                    className="text-xs"
                  >
                    <Sparkles className="h-3 w-3" />
                    <span className="ml-1">Derive from other tokens…</span>
                  </CommandItem>
                </CommandGroup>
                <TokenCommandGroup
                  mode={mode}
                  onSelect={(token) => {
                    onChange({ kind: "alias", token });
                    setOpen(false);
                  }}
                />
                {system?.useTailwindColors && (
                  <TailwindColorCommandGroup
                    onSelect={(color) => {
                      onChange({
                        kind: "derived",
                        base: { kind: "tailwind", color },
                        ops: [],
                      });
                      setOpen(false);
                    }}
                  />
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}

      {(isAlias || isDerived) && (
        <button
          type="button"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 transition hover:bg-accent group-hover:opacity-100"
          onClick={() => onChange({ kind: "raw", value: resolvedHex })}
          title="Unlink (freeze current hex)"
        >
          <Unlink className="h-3 w-3" />
        </button>
      )}
      {onReset && !inherited && (
        <button
          type="button"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 transition hover:bg-accent group-hover:opacity-100"
          onClick={onReset}
          title="Reset to inherited (follow primary mode)"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      )}

      {deriving && (
        <DerivationEditor
          open={deriving}
          onOpenChange={setDeriving}
          initial={
            value?.kind === "derived"
              ? { base: value.base, ops: value.ops }
              : {
                  base:
                    value?.kind === "alias"
                      ? { kind: "token", token: value.token }
                      : { kind: "raw", value: resolvedHex },
                  ops: [],
                }
          }
          onSave={(base, ops) => onChange({ kind: "derived", base, ops })}
        />
      )}
    </div>
  );
}

// ============================================================================
// FG PICKER — unified per-(surface, mode) fg behaviour
// ============================================================================

function FgPicker({
  fg,
  autoFg,
  mode,
  inherited,
  resolveBaseHex,
  onChange,
  onReset,
}: {
  fg: SurfaceFgChoice;
  autoFg: "light" | "dark" | null;
  mode: string;
  inherited: boolean;
  resolveBaseHex: ResolveBaseHex;
  onChange: (next: SurfaceFgChoice) => void;
  onReset?: () => void;
}) {
  const system = useSystem();
  const [open, setOpen] = useState(false);

  const chipHex =
    fg.kind === "alias"
      ? resolveBaseHex(fg.token, mode)
      : fg.kind === "tailwind"
        ? getTailwindHex(fg.color)
        : fg.kind === "light"
          ? "#ffffff"
          : fg.kind === "dark"
            ? "#000000"
            : null;

  const trigger = (() => {
    if (fg.kind === "auto") {
      return (
        <>
          <span className="flex h-5 w-5 shrink-0 overflow-hidden rounded border">
            <span className="flex-1 bg-black" />
            <span className="flex-1 bg-white" />
          </span>
          <span className="truncate font-mono text-xs text-muted-foreground">
            auto{autoFg ? ` (${autoFg})` : ""}
          </span>
        </>
      );
    }
    return (
      <>
        <span
          className="h-5 w-5 shrink-0 rounded border"
          style={{ background: chipHex ?? "transparent" }}
        />
        <span
          className={cn(
            "truncate rounded px-1.5 py-0.5 font-mono text-xs",
            fg.kind === "alias" &&
              "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
            fg.kind === "tailwind" &&
              "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
            (fg.kind === "light" || fg.kind === "dark") && "text-muted-foreground"
          )}
        >
          {fg.kind === "alias"
            ? fg.token
            : fg.kind === "tailwind"
              ? fg.color
              : `${fg.kind} fg`}
        </span>
      </>
    );
  })();

  return (
    <div className={cn("group/fg flex min-w-0 items-center gap-1", inherited && "opacity-45")}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded border bg-background px-1.5 text-left transition hover:bg-accent"
          title={
            inherited
              ? "Inherited from the primary mode — edit to override"
              : "Foreground behaviour for this (surface, mode) cell"
          }
        >
          {trigger}
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search color tokens…" />
            <CommandList>
              <CommandEmpty>No tokens found.</CommandEmpty>
              <CommandGroup heading="Behaviour">
                {(
                  [
                    ["auto", `auto${autoFg ? ` → ${autoFg}` : ""}`],
                    ["light", "light fg"],
                    ["dark", "dark fg"],
                  ] as const
                ).map(([kind, label]) => (
                  <CommandItem
                    key={kind}
                    value={kind}
                    onSelect={() => {
                      onChange({ kind } as SurfaceFgChoice);
                      setOpen(false);
                    }}
                    className="text-xs"
                  >
                    <span className="font-mono">{label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <TokenCommandGroup
                heading="Or pick a token"
                mode={mode}
                onSelect={(token) => {
                  onChange({ kind: "alias", token });
                  setOpen(false);
                }}
              />
              {system?.useTailwindColors && (
                <TailwindColorCommandGroup
                  onSelect={(color) => {
                    onChange({ kind: "tailwind", color });
                    setOpen(false);
                  }}
                />
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {onReset && !inherited && (
        <button
          type="button"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 transition hover:bg-accent group-hover/fg:opacity-100"
          onClick={onReset}
          title="Reset to inherited (follow primary mode)"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// ============================================================================
// ANCHOR PICKER — auto / surface / hex / token / tailwind
// ============================================================================

function AnchorPicker({
  anchor,
  surfaceIsDark,
  resolveBaseHex,
  onChange,
}: {
  anchor: SurfaceLevelAnchor;
  surfaceIsDark: boolean;
  resolveBaseHex: ResolveBaseHex;
  onChange: (next: SurfaceLevelAnchor) => void;
}) {
  const [linkerOpen, setLinkerOpen] = useState(false);
  const system = useSystem();

  const setKind = (kind: string | null) => {
    if (!kind) return;
    if (kind === "auto") onChange({ kind: "auto" });
    else if (kind === "surface") onChange({ kind: "surface" });
    else if (kind === "raw")
      onChange({ kind: "raw", value: surfaceIsDark ? "#ffffff" : "#000000" });
    else if (kind === "tailwind")
      onChange({ kind: "tailwind", color: surfaceIsDark ? "slate-50" : "slate-950" });
    else setLinkerOpen(true);
  };

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Select value={anchor.kind} onValueChange={setKind}>
        <SelectTrigger className="h-7 w-[5.5rem] text-[10px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto" className="text-xs">auto</SelectItem>
          <SelectItem value="surface" className="text-xs">surface</SelectItem>
          <SelectItem value="raw" className="text-xs">hex</SelectItem>
          <SelectItem value="alias" className="text-xs">token</SelectItem>
          {(system?.useTailwindColors || anchor.kind === "tailwind") && (
            <SelectItem value="tailwind" className="text-xs">tailwind</SelectItem>
          )}
        </SelectContent>
      </Select>
      {anchor.kind === "auto" && (
        <span
          className="flex h-7 w-7 shrink-0 overflow-hidden rounded border"
          title={`Auto: ${surfaceIsDark ? "#ffffff" : "#000000"}`}
        >
          <span className="flex-1 bg-black" />
          <span className="flex-1 bg-white" />
        </span>
      )}
      {anchor.kind === "surface" && (
        <span
          className="inline-flex h-7 shrink-0 items-center rounded border px-2 font-mono text-[10px] text-muted-foreground"
          title="The current surface's own base (resolves per-surface)"
        >
          surface
        </span>
      )}
      {anchor.kind === "raw" && (
        <ColorPickerPopover
          value={anchor.value}
          onChange={(next) => onChange({ kind: "raw", value: next })}
          swatchClassName="h-7 w-7"
        />
      )}
      {anchor.kind === "tailwind" && (
        <TailwindColorPopover
          onSelect={(color) => onChange({ kind: "tailwind", color })}
        >
          <button
            type="button"
            className="inline-flex h-7 max-w-28 items-center gap-1 truncate rounded bg-cyan-100 px-2 font-mono text-[10px] text-cyan-700 transition hover:bg-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300"
            title={`${anchor.color} · ${getTailwindHex(anchor.color) ?? "?"}`}
          >
            <span
              className="h-3 w-3 shrink-0 rounded border"
              style={{ background: getTailwindHex(anchor.color) ?? "transparent" }}
            />
            <span className="truncate">{anchor.color}</span>
          </button>
        </TailwindColorPopover>
      )}
      {anchor.kind === "alias" && (
        <Popover open={linkerOpen} onOpenChange={setLinkerOpen}>
          <PopoverTrigger className="h-7 max-w-28 truncate rounded bg-purple-100 px-2 font-mono text-[10px] text-purple-700 transition hover:bg-purple-200 dark:bg-purple-900/30 dark:text-purple-300">
            {anchor.token || "…"}
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search color tokens…" />
              <CommandList>
                <CommandEmpty>No tokens found.</CommandEmpty>
                <TokenCommandGroup
                  onSelect={(token) => {
                    onChange({ kind: "alias", token });
                    setLinkerOpen(false);
                  }}
                />
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
      {/* Open the token linker when "token" is selected with no pick yet */}
      {anchor.kind !== "alias" && linkerOpen && (
        <Popover open onOpenChange={setLinkerOpen}>
          <PopoverTrigger className="hidden" />
          <PopoverContent className="w-72 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search color tokens…" autoFocus />
              <CommandList>
                <CommandEmpty>No tokens found.</CommandEmpty>
                <TokenCommandGroup
                  onSelect={(token) => {
                    onChange({ kind: "alias", token });
                    setLinkerOpen(false);
                  }}
                />
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

// ============================================================================
// BRANCH EDITORS — compact single-row layouts matching the cloud table
// ============================================================================

/** Measured APCA readout: rounded number, colored like the cloud. */
function LcNumber({ lc }: { lc: number | null }) {
  if (lc === null) return <span className="w-6" />;
  return (
    <code
      className={cn(
        "w-6 shrink-0 text-right text-[11px] tabular-nums",
        lc < 30 ? "text-red-500" : lc < 45 ? "text-amber-500" : "text-muted-foreground"
      )}
      title="Measured APCA Lc on the preview surface"
    >
      {Math.round(lc)}
    </code>
  );
}

function FgBranchEditor({
  branch,
  levels,
  cellHex,
  measureHex,
  surfaceIsDark,
  resolveBaseHex,
  onChange,
}: {
  branch: SurfaceLevelBranch;
  levels: SurfaceLevel[];
  cellHex: string | null;
  measureHex: string | null;
  surfaceIsDark: boolean;
  resolveBaseHex: ResolveBaseHex;
  onChange: (b: SurfaceLevelBranch) => void;
}) {
  const target = normalizeFgTarget(branch);
  const measureRef = getMeasureAgainst(branch);
  const measuredLc = cellHex && measureHex ? apcaLc(cellHex, measureHex) : null;

  const setMeasure = (v: string | null) => {
    if (!v) return;
    const ref: SurfaceMeasureRef | undefined = v.startsWith("level:")
      ? { kind: "level", levelId: v.slice(6) }
      : undefined;
    onChange({ ...branch, measureAgainst: ref } as SurfaceLevelBranch);
  };

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <AnchorPicker
        anchor={branch.anchor}
        surfaceIsDark={surfaceIsDark}
        resolveBaseHex={resolveBaseHex}
        onChange={(anchor) => onChange({ ...branch, anchor } as SurfaceLevelBranch)}
      />
      <Select
        value={
          !measureRef || measureRef.kind !== "level"
            ? "surface"
            : `level:${measureRef.levelId}`
        }
        onValueChange={setMeasure}
      >
        <SelectTrigger className="h-7 w-[6.2rem] text-[10px]">
          <span className="mr-0.5 text-muted-foreground">vs</span>
          <SelectValue>
            {!measureRef || measureRef.kind !== "level"
              ? "surface"
              : levels.find((l) => l.id === measureRef.levelId)?.name ?? "level"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="surface" className="text-xs">surface</SelectItem>
          {levels.map((l) => (
            <SelectItem key={l.id} value={`level:${l.id}`} className="text-xs">
              {l.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {target.kind === "apca" ? (
        <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <button
            type="button"
            className="rounded px-0.5 hover:bg-accent"
            title="APCA contrast target — click to switch to a recipe mix"
            onClick={() =>
              onChange({
                ...branch,
                target: { kind: "mix", mix: 0.7 },
              } as SurfaceLevelBranch)
            }
          >
            Lc
          </button>
          <Input
            type="number"
            min={0}
            max={108}
            value={target.lc}
            onChange={(e) =>
              onChange({
                ...branch,
                target: { kind: "apca", lc: Number(e.target.value) },
              } as SurfaceLevelBranch)
            }
            className="h-7 w-14 text-xs"
          />
        </label>
      ) : (
        <label className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
          <button
            type="button"
            className="rounded px-0.5 hover:bg-accent"
            title="Mix recipe — click to switch to an APCA contrast target"
            onClick={() =>
              onChange({
                ...branch,
                target: { kind: "apca", lc: 75 },
              } as SurfaceLevelBranch)
            }
          >
            mix
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={target.mix}
            onChange={(e) =>
              onChange({
                ...branch,
                target: { kind: "mix", mix: parseFloat(e.target.value) },
              } as SurfaceLevelBranch)
            }
            className="w-16"
          />
        </label>
      )}
      <span
        className="h-7 w-7 shrink-0 rounded border"
        style={{ background: cellHex ?? "transparent" }}
        title={cellHex ?? "Add a surface to preview"}
      />
      <LcNumber lc={measuredLc} />
    </div>
  );
}

function ShiftMixWithRow({
  mixWith,
  resolveBaseHex,
  onChange,
}: {
  mixWith: SurfaceShiftBranch["mixWith"];
  resolveBaseHex: ResolveBaseHex;
  onChange: (next: SurfaceShiftBranch["mixWith"]) => void;
}) {
  const [open, setOpen] = useState(false);
  const system = useSystem();
  const twColor = mixWith && "tailwind" in mixWith ? mixWith.tailwind : null;
  const tokenRef = mixWith && "token" in mixWith ? mixWith.token : null;
  const displayName = twColor ?? tokenRef ?? null;
  const displayHex = twColor
    ? getTailwindHex(twColor)
    : tokenRef
      ? resolveBaseHex(tokenRef)
      : null;

  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="w-7 shrink-0 text-muted-foreground">mix</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className={cn(
            "flex h-6 min-w-0 flex-1 items-center gap-1 truncate rounded px-1.5 text-left font-mono text-[10px]",
            twColor
              ? "bg-cyan-100 text-cyan-700 hover:bg-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300"
              : mixWith
                ? "bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-900/30 dark:text-purple-300"
                : "border text-muted-foreground hover:bg-accent"
          )}
          title={displayName ?? "Pick a color to tint with"}
        >
          {displayHex && (
            <span
              className="h-3 w-3 shrink-0 rounded border"
              style={{ background: displayHex }}
            />
          )}
          <span className="truncate">{displayName ?? "off"}</span>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search color tokens…" />
            <CommandList>
              <CommandEmpty>No tokens found.</CommandEmpty>
              {mixWith && (
                <CommandGroup>
                  <CommandItem
                    onSelect={() => {
                      onChange(undefined);
                      setOpen(false);
                    }}
                    className="text-xs"
                  >
                    <Unlink className="h-3 w-3" />
                    <span className="ml-1">Turn off mix</span>
                  </CommandItem>
                </CommandGroup>
              )}
              <TokenCommandGroup
                heading="Mix with token"
                onSelect={(token) => {
                  onChange({ token, weight: mixWith?.weight ?? 0.3 });
                  setOpen(false);
                }}
              />
              {(system?.useTailwindColors || twColor) && (
                <TailwindColorCommandGroup
                  heading="Mix with Tailwind"
                  onSelect={(color) => {
                    onChange({ tailwind: color, weight: mixWith?.weight ?? 0.3 });
                    setOpen(false);
                  }}
                />
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {mixWith && (
        <>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={mixWith.weight}
            onChange={(e) => onChange({ ...mixWith, weight: parseFloat(e.target.value) })}
            className="w-14 min-w-0"
          />
          <code className="w-9 text-right tabular-nums">
            {Math.round(mixWith.weight * 100)}%
          </code>
        </>
      )}
    </div>
  );
}

function ShiftBranchEditor({
  branch,
  cellHex,
  resolveBaseHex,
  onChange,
}: {
  branch: SurfaceShiftBranch;
  cellHex: string | null;
  resolveBaseHex: ResolveBaseHex;
  onChange: (b: SurfaceShiftBranch) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="min-w-0 flex-1 space-y-0.5">
        <SliderRow
          label="Step"
          value={branch.stepStrength ?? 0}
          min={-1}
          max={1}
          step={0.025}
          format={(v) => (v >= 0 ? `+${v.toFixed(3)}` : v.toFixed(3))}
          onChange={(stepStrength) => onChange({ ...branch, stepStrength })}
        />
        <SliderRow
          label="ΔC"
          value={branch.chromaDelta ?? 0}
          min={-0.4}
          max={0.4}
          step={0.005}
          format={(v) => (v >= 0 ? `+${v.toFixed(3)}` : v.toFixed(3))}
          onChange={(chromaDelta) =>
            onChange({ ...branch, chromaDelta: chromaDelta === 0 ? undefined : chromaDelta })
          }
        />
        <ShiftMixWithRow
          mixWith={branch.mixWith}
          resolveBaseHex={resolveBaseHex}
          onChange={(mixWith) => onChange({ ...branch, mixWith })}
        />
      </div>
      <span
        className="h-8 w-8 shrink-0 rounded border"
        style={{ background: cellHex ?? "transparent" }}
        title={cellHex ? `Result: ${cellHex}` : "Add a surface to preview"}
      />
    </div>
  );
}

function MixBranchEditor({
  branch,
  cellHex,
  measureHex,
  surfaceIsDark,
  resolveBaseHex,
  onChange,
}: {
  branch: SurfaceMixBranch;
  cellHex: string | null;
  measureHex: string | null;
  surfaceIsDark: boolean;
  resolveBaseHex: ResolveBaseHex;
  onChange: (b: SurfaceMixBranch) => void;
}) {
  const measuredLc = cellHex && measureHex ? apcaLc(cellHex, measureHex) : null;
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <AnchorPicker
        anchor={branch.anchor}
        surfaceIsDark={surfaceIsDark}
        resolveBaseHex={resolveBaseHex}
        onChange={(anchor) => onChange({ ...branch, anchor })}
      />
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={branch.mix}
        onChange={(e) => onChange({ ...branch, mix: parseFloat(e.target.value) })}
        className="w-20 min-w-0"
      />
      <code className="w-9 shrink-0 text-right text-[10px] tabular-nums">
        {Math.round(branch.mix * 100)}%
      </code>
      <span
        className="h-7 w-7 shrink-0 rounded border"
        style={{ background: cellHex ?? "transparent" }}
        title={cellHex ?? undefined}
      />
      <LcNumber lc={measuredLc} />
    </div>
  );
}

function OpacityBranchEditor({
  branch,
  source,
  bake,
  cellHex,
  onSourceChange,
  onBakeChange,
  onChange,
}: {
  branch: SurfaceOpacityBranch;
  source: SurfaceOpacitySource;
  bake: "composite" | "alpha";
  cellHex: string | null;
  onSourceChange: (next: SurfaceOpacitySource) => void;
  onBakeChange: (next: "composite" | "alpha") => void;
  onChange: (b: SurfaceOpacityBranch) => void;
}) {
  const system = useSystem();
  const isTw = typeof source === "object" && source.kind === "tailwind";
  const selectValue =
    typeof source === "string" ? source : isTw ? "__tailwind__" : "__alias__";

  return (
    <div className="min-w-0 flex-1 space-y-1">
      <div className="flex items-center gap-2 text-[10px]">
        <span className="shrink-0 text-muted-foreground">Fade</span>
        <Select
          value={selectValue}
          onValueChange={(v) =>
            v &&
            onSourceChange(
              v === "fg" || v === "surface" ? v : { kind: "tailwind", color: "slate-500" }
            )
          }
        >
          <SelectTrigger className="h-7 min-w-0 flex-1 text-xs">
            <SelectValue>
              {typeof source === "string"
                ? source
                : isTw && typeof source === "object" && source.kind === "tailwind"
                  ? `tw:${source.color}`
                  : "token"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fg" className="text-xs">fg</SelectItem>
            <SelectItem value="surface" className="text-xs">surface</SelectItem>
            {(system?.useTailwindColors || isTw) && (
              <SelectItem value="__tailwind__" className="text-xs">tailwind</SelectItem>
            )}
          </SelectContent>
        </Select>
        {typeof source === "object" && source.kind === "tailwind" && (
          <TailwindColorPopover
            onSelect={(color) => onSourceChange({ kind: "tailwind", color })}
          >
            <button
              type="button"
              className="inline-flex h-7 shrink-0 items-center gap-1 truncate rounded bg-cyan-100 px-1.5 font-mono text-[10px] text-cyan-700 transition hover:bg-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300"
              title={source.color}
            >
              <span
                className="h-3 w-3 shrink-0 rounded border"
                style={{ background: getTailwindHex(source.color) ?? "transparent" }}
              />
              <span className="max-w-20 truncate">{source.color}</span>
            </button>
          </TailwindColorPopover>
        )}
        <div className="flex shrink-0 overflow-hidden rounded-md border">
          {(["alpha", "composite"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onBakeChange(mode)}
              title={
                mode === "alpha"
                  ? "Ship a true translucent color (oklch … / a)"
                  : "Flatten over the surface into an opaque hex"
              }
              className={cn(
                "px-1.5 py-0.5 text-[10px] transition",
                bake === mode
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-accent"
              )}
            >
              {mode === "alpha" ? "α" : "flat"}
            </button>
          ))}
        </div>
        <span
          className="h-7 w-7 shrink-0 rounded border"
          style={{
            backgroundImage:
              bake === "alpha"
                ? "linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%),linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%)"
                : undefined,
            backgroundSize: "8px 8px",
            backgroundPosition: "0 0, 4px 4px",
          }}
          title={cellHex ? `On surface: ${cellHex}` : undefined}
        >
          <span
            className="block h-full w-full rounded-[3px]"
            style={{
              background:
                bake === "alpha" && cellHex
                  ? cellHex.length === 9
                    ? cellHex
                    : withAlpha(cellHex, branch.alpha)
                  : (cellHex ?? "transparent"),
            }}
          />
        </span>
      </div>
      <SliderRow
        label="α"
        value={branch.alpha}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(alpha) => onChange({ alpha })}
      />
    </div>
  );
}

function ScaleStepBranchEditor({
  branch,
  cellHex,
  onChange,
}: {
  branch: SurfaceScaleStepBranch;
  cellHex: string | null;
  onChange: (b: SurfaceScaleStepBranch) => void;
}) {
  const system = useSystem();
  const resolver = useResolver();

  const scales = useMemo(() => {
    const prefixes = new Set<string>();
    for (const o of resolver.aliasOptions([])) {
      const dot = o.name.lastIndexOf(".");
      if (dot > 0) prefixes.add(o.name.slice(0, dot));
    }
    return [...prefixes].sort();
  }, [resolver]);

  const selected =
    branch.scale?.kind === "tailwind"
      ? `tw:${branch.scale.family}`
      : branch.scale?.kind === "alias"
        ? branch.scale.token.slice(0, branch.scale.token.lastIndexOf("."))
        : "__parent__";

  const setScale = (v: string | null) => {
    if (!v) return;
    if (v === "__parent__") onChange({ ...branch, scale: { kind: "parent" } });
    else if (v.startsWith("tw:"))
      onChange({ ...branch, scale: { kind: "tailwind", family: v.slice(3) } });
    else onChange({ ...branch, scale: { kind: "alias", token: `${v}.${branch.step}` } });
  };

  return (
    <div className="flex min-w-0 items-center gap-2">
      <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
        step
        <Input
          value={branch.step}
          onChange={(e) => onChange({ ...branch, step: e.target.value.trim() })}
          className="h-7 w-14 font-mono text-xs"
          placeholder="600"
        />
      </label>
      <Select value={selected} onValueChange={setScale}>
        <SelectTrigger className="h-7 min-w-0 flex-1 text-xs">
          <SelectValue>
            {selected === "__parent__" ? "Parent scale" : selected}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__parent__" className="text-xs">
            Parent scale
          </SelectItem>
          {scales.map((prefix) => (
            <SelectItem key={prefix} value={prefix} className="font-mono text-xs">
              {prefix}
            </SelectItem>
          ))}
          {(system?.useTailwindColors || branch.scale?.kind === "tailwind") &&
            Object.keys(TAILWIND_FAMILY_NAMES).map((family) => (
              <SelectItem
                key={`tw:${family}`}
                value={`tw:${family}`}
                className="font-mono text-xs"
              >
                tw:{family}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      <span
        className="h-7 w-7 shrink-0 rounded border"
        style={{ background: cellHex ?? "transparent" }}
        title={cellHex ?? "Step not found — falls back to the surface base"}
      />
    </div>
  );
}

// ============================================================================
// RULE ROW — one table row: ▲▼ | type icon | name | light | dark | link | ⋮
// ============================================================================

const RULE_KIND_ICONS: Record<SurfaceLevelRule["kind"], typeof TypeIcon> = {
  fg: TypeIcon,
  "surface-shift": Contrast,
  "surface-mix": Blend,
  opacity: Droplet,
  "scale-step": Layers,
};

function RuleRow({
  level,
  levels,
  previewSurface,
  modes,
  threshold,
  resolveBaseHex,
  resolveScaleStep,
  pageBgByMode,
  canMoveUp,
  canMoveDown,
  onChange,
  onMove,
  onRemove,
}: {
  level: SurfaceLevel;
  levels: SurfaceLevel[];
  previewSurface: SurfaceRow | null;
  modes: string[];
  threshold: number;
  resolveBaseHex: ResolveBaseHex;
  resolveScaleStep: ReturnType<typeof makeResolveScaleStep>;
  pageBgByMode: Record<string, string | undefined>;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange: (next: SurfaceLevel) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const rule = level.rule;
  const primary = modeKeyPrimary(modes);
  const lightMode = modes[0];
  const darkMode = modes[1];

  const branchesEqual = JSON.stringify(rule.onLight) === JSON.stringify(rule.onDark);
  const [unlinked, setUnlinked] = useState(!branchesEqual);
  const linked = !unlinked;

  const patchBranch = (side: "onLight" | "onDark", branch: ChannelBranch) => {
    if (linked) {
      onChange({
        ...level,
        rule: { ...rule, onLight: branch, onDark: branch } as SurfaceLevelRule,
      });
    } else {
      onChange({ ...level, rule: { ...rule, [side]: branch } as SurfaceLevelRule });
    }
  };

  const cellFor = (mode: string | undefined): string | null => {
    if (!previewSurface || !mode) return null;
    const expanded = expandSurfaceModes(previewSurface, modes);
    const effRule = effectiveLevelRule(expanded, level);
    if (!effRule) return null;
    return computeCellHex(expanded, { ...level, rule: effRule }, mode, threshold, resolveBaseHex, {
      allLevels: levels,
      primaryMode: primary,
      pageBgHex: pageBgByMode[mode],
      resolveScaleStep,
    });
  };

  const measureFor = (
    branch: SurfaceLevelBranch,
    mode: string | undefined
  ): string | null => {
    if (!previewSurface || !mode || rule.kind !== "fg") return null;
    const expanded = expandSurfaceModes(previewSurface, modes);
    const baseHex = resolveSurfaceBaseHex(expanded.baseByMode[mode], mode, resolveBaseHex);
    if (!baseHex) return null;
    return resolveMeasureBackdropHex(
      getMeasureAgainst(branch),
      expanded,
      level.id,
      mode,
      baseHex,
      threshold,
      resolveBaseHex,
      levels,
      undefined,
      primary,
      pageBgByMode[mode],
      resolveScaleStep
    );
  };

  const surfaceHexFor = (mode: string | undefined): string | null => {
    if (!previewSurface || !mode) return null;
    const expanded = expandSurfaceModes(previewSurface, modes);
    return resolveSurfaceBaseHex(expanded.baseByMode[mode], mode, resolveBaseHex);
  };

  const surfaceIsDarkFor = (mode: string | undefined): boolean => {
    const hex = surfaceHexFor(mode);
    return hex ? hexToOklch(hex).l < threshold : false;
  };

  const renderBranch = (side: "onLight" | "onDark") => {
    const mode = side === "onLight" ? lightMode : darkMode;
    const cellHex = cellFor(mode);
    const surfaceIsDark = surfaceIsDarkFor(mode);
    if (rule.kind === "fg") {
      const branch = rule[side];
      return (
        <FgBranchEditor
          branch={branch}
          levels={levels.filter((l) => l.id !== level.id)}
          cellHex={cellHex}
          measureHex={measureFor(branch, mode)}
          surfaceIsDark={surfaceIsDark}
          resolveBaseHex={resolveBaseHex}
          onChange={(b) => patchBranch(side, b)}
        />
      );
    }
    if (rule.kind === "surface-shift") {
      return (
        <ShiftBranchEditor
          branch={rule[side]}
          cellHex={cellHex}
          resolveBaseHex={resolveBaseHex}
          onChange={(b) => patchBranch(side, b)}
        />
      );
    }
    if (rule.kind === "surface-mix") {
      return (
        <MixBranchEditor
          branch={rule[side]}
          cellHex={cellHex}
          measureHex={surfaceHexFor(mode)}
          surfaceIsDark={surfaceIsDark}
          resolveBaseHex={resolveBaseHex}
          onChange={(b) => patchBranch(side, b)}
        />
      );
    }
    if (rule.kind === "opacity") {
      return (
        <OpacityBranchEditor
          branch={rule[side]}
          source={rule.source}
          bake={rule.bake ?? "composite"}
          cellHex={cellHex}
          onSourceChange={(source) => onChange({ ...level, rule: { ...rule, source } })}
          onBakeChange={(bake) => onChange({ ...level, rule: { ...rule, bake } })}
          onChange={(b) => patchBranch(side, b)}
        />
      );
    }
    return (
      <ScaleStepBranchEditor
        branch={rule[side]}
        cellHex={cellHex}
        onChange={(b) => patchBranch(side, b)}
      />
    );
  };

  const Icon = RULE_KIND_ICONS[rule.kind];

  return (
    <div className="grid grid-cols-[1.5rem_2.25rem_9rem_1fr_1fr_3.5rem] items-center gap-2 border-t px-2 py-2 first:border-t-0">
      {/* reorder */}
      <div className="flex flex-col items-center">
        <button
          type="button"
          disabled={!canMoveUp}
          onClick={() => onMove(-1)}
          className="text-muted-foreground/60 hover:text-foreground disabled:opacity-20"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={!canMoveDown}
          onClick={() => onMove(1)}
          className="text-muted-foreground/60 hover:text-foreground disabled:opacity-20"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* type icon = rule kind picker */}
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-8 w-8 items-center justify-center rounded-md border transition hover:bg-accent"
          title={`${RULE_KIND_LABELS[rule.kind]} — click to change the rule type`}
        >
          <Icon className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {(Object.keys(RULE_KIND_LABELS) as SurfaceLevelRule["kind"][]).map((k) => {
            const KIcon = RULE_KIND_ICONS[k];
            return (
              <DropdownMenuItem
                key={k}
                className="text-xs"
                onClick={() => {
                  setUnlinked(false);
                  onChange({ ...level, rule: defaultRuleForKind(k) });
                }}
              >
                <KIcon className="h-3 w-3" /> {RULE_KIND_LABELS[k]}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <Input
        value={level.name}
        onChange={(e) => onChange({ ...level, name: e.target.value })}
        className="h-8 font-mono text-xs"
      />

      {/* light branch */}
      <div className="min-w-0">{renderBranch("onLight")}</div>

      {/* dark branch — dimmed while linked; touching it unlinks */}
      <div
        className={cn("min-w-0", linked && "pointer-events-auto opacity-45")}
        onPointerDownCapture={() => {
          if (linked) setUnlinked(true);
        }}
      >
        {darkMode ? renderBranch("onDark") : null}
      </div>

      {/* link + menu */}
      <div className="flex items-center justify-end gap-0.5">
        <button
          type="button"
          className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent"
          title={
            linked
              ? "Linked: dark mirrors light. Click to edit independently."
              : "Unlinked. Click to re-link (copies the light column)."
          }
          onClick={() => {
            if (linked) setUnlinked(true);
            else {
              setUnlinked(false);
              onChange({
                ...level,
                rule: { ...rule, onDark: rule.onLight } as SurfaceLevelRule,
              });
            }
          }}
        >
          {linked ? <Link2 className="h-3.5 w-3.5" /> : <Link2Off className="h-3.5 w-3.5" />}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
              <span>Preview as</span>
              <Select
                value={level.display ?? "text"}
                onValueChange={(display) =>
                  display &&
                  onChange({ ...level, display: display as SurfaceLevel["display"] })
                }
              >
                <SelectTrigger className="h-6 w-24 text-[10px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text" className="text-xs">text</SelectItem>
                  <SelectItem value="separator" className="text-xs">separator</SelectItem>
                  <SelectItem value="bg" className="text-xs">bg</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DropdownMenuItem variant="destructive" className="text-xs" onClick={onRemove}>
              Delete rule
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ============================================================================
// MATRIX — swatch pills ("● on / off") per (surface, level), computed on
// the primary mode, exactly like the cloud table.
// ============================================================================

function cellEnabled(surface: SurfaceRow, levelId: string): boolean {
  const states = surface.levelStates;
  if (!states) return true;
  const entry = states[levelId] ?? states[WILDCARD_LEVEL_KEY];
  return entry?.state !== "disabled";
}

function MatrixSection({
  config,
  modes,
  threshold,
  resolveBaseHex,
  resolveScaleStep,
  pageBgByMode,
  onPatchSurface,
}: {
  config: SurfacesConfig;
  modes: string[];
  threshold: number;
  resolveBaseHex: ResolveBaseHex;
  resolveScaleStep: ReturnType<typeof makeResolveScaleStep>;
  pageBgByMode: Record<string, string | undefined>;
  onPatchSurface: (id: string, patch: Partial<SurfaceRow>) => void;
}) {
  const primary = modes[0];
  if (config.surfaces.length === 0 || config.levels.length === 0) return null;

  const cellHexFor = (surface: SurfaceRow, level: SurfaceLevel): string | null => {
    const expanded = expandSurfaceModes(surface, modes);
    return computeCellHex(expanded, level, primary, threshold, resolveBaseHex, {
      allLevels: config.levels,
      primaryMode: modeKeyPrimary(modes),
      pageBgHex: pageBgByMode[primary],
      resolveScaleStep,
    });
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Surface × level matrix
        </h3>
        <span className="ml-auto text-[11px] text-muted-foreground">
          Which levels each surface emits — <span className="text-foreground">on</span> · off
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-muted/40 text-left">
              <th className="px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
                Surface
              </th>
              {config.levels.map((l) => (
                <th
                  key={l.id}
                  className="px-3 py-1.5 text-center font-mono text-[11px] font-normal text-muted-foreground"
                >
                  {l.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {config.surfaces.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="px-3 py-1.5 font-mono text-[11px]">{s.name}</td>
                {config.levels.map((l) => {
                  const enabled = cellEnabled(s, l.id);
                  const hex = enabled ? cellHexFor(s, l) : null;
                  return (
                    <td key={l.id} className="px-3 py-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          const states = { ...(s.levelStates ?? {}) };
                          states[l.id] = enabled
                            ? { state: "disabled" }
                            : { state: "default" };
                          onPatchSurface(s.id, { levelStates: states });
                        }}
                        className={cn(
                          "flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1 transition hover:bg-accent",
                          !enabled && "opacity-40"
                        )}
                        title={
                          enabled
                            ? `${s.name} emits ${l.name} — click to disable`
                            : `${s.name} skips ${l.name} — click to enable`
                        }
                      >
                        <span
                          className="h-3.5 w-3.5 rounded-full border"
                          style={{ background: hex ?? "transparent" }}
                        />
                        <span className="text-[10px] text-muted-foreground">
                          {enabled ? "on" : "off"}
                        </span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ============================================================================
// PREVIEW — live client-side materialization of the DRAFT config
// ============================================================================

function SurfacesPreview({ config, modes }: { config: SurfacesConfig; modes: string[] }) {
  const resolver = useResolver();
  const tokens = useMemo(() => {
    try {
      const aliasOptions = resolver.aliasOptions(modes);
      return generateSurfaceTokens(config, modes, (ref, mode) => resolver.resolveRaw(ref, mode), {
        resolveScaleStep: makeResolveScaleStep(aliasOptions),
      });
    } catch {
      return [];
    }
  }, [config, modes, resolver]);

  const byName = useMemo(() => new Map(tokens.map((t) => [t.name, t])), [tokens]);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {config.surfaces.map((surface) => {
        if (!surface.name.trim()) return null;
        const levelsFor = config.levels.filter((l) => cellEnabled(surface, l.id));
        return (
          <div key={surface.id} className="overflow-hidden rounded-md border">
            <div className="bg-muted/40 px-2 py-1 font-mono text-xs">
              {surface.name}
              {surface.bareLevels && (
                <span className="ml-2 text-[10px] text-muted-foreground">(bare)</span>
              )}
            </div>
            <div className="grid" style={{ gridTemplateColumns: `repeat(${modes.length}, 1fr)` }}>
              {modes.map((mode) => {
                const baseHex =
                  resolveSurfaceBaseHex(
                    surface.baseByMode[mode] ?? surface.baseByMode[modes[0]],
                    mode,
                    (ref, m) => resolver.resolveRaw(ref, m)
                  ) ?? "transparent";
                return (
                  <div
                    key={mode}
                    className="flex min-h-[7rem] flex-col border-l px-2 py-1.5 first:border-l-0"
                    style={{ background: baseHex }}
                  >
                    <div className="pb-1 font-mono text-[10px] opacity-50">{mode}</div>
                    <div className="space-y-1">
                      {levelsFor.map((lvl) => {
                        const tokenName = surface.bareLevels
                          ? lvl.name
                          : `${surface.name}.${lvl.name}`;
                        const hex = byName.get(tokenName)?.values[mode]?.value;
                        if (!hex) return null;
                        if (lvl.display === "separator") {
                          return (
                            <div
                              key={lvl.id}
                              style={{ borderTop: `2px solid ${hex}` }}
                              title={`${tokenName}: ${hex}`}
                            />
                          );
                        }
                        if (lvl.display === "bg") {
                          return (
                            <div
                              key={lvl.id}
                              className="truncate rounded px-1.5 py-0.5 text-center font-mono text-[11px]"
                              style={{ background: hex }}
                              title={`${tokenName}: ${hex}`}
                            >
                              {lvl.name}
                            </div>
                          );
                        }
                        return (
                          <div
                            key={lvl.id}
                            className="truncate font-mono text-[11px]"
                            style={{ color: hex }}
                            title={`${tokenName}: ${hex}`}
                          >
                            {lvl.name}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// MAIN VIEW
// ============================================================================

export function SurfacesEditorView({ collection }: { collection: CollectionDoc }) {
  const actions = useActions();
  const resolver = useResolver();
  const persisted = collection.surfacesConfig as SurfacesConfig | undefined;
  const [draft, setDraft] = useState<SurfacesConfig | null>(persisted ?? null);
  const [persistedAtEdit, setPersistedAtEdit] = useState(persisted);
  const [previewSurfaceId, setPreviewSurfaceId] = useState<string | null>(null);

  const dirty =
    draft !== null && JSON.stringify(draft) !== JSON.stringify(persistedAtEdit ?? null);
  const config = dirty ? draft : (persisted ?? draft);

  const modes = collection.modes;
  const primary = modes[0];
  const threshold = config?.contrastThreshold ?? DEFAULT_THRESHOLD;
  const resolveBaseHex: ResolveBaseHex = (ref, mode) => resolver.resolveRaw(ref, mode);
  const resolveScaleStep = useMemo(
    () => makeResolveScaleStep(resolver.aliasOptions(modes)),
    [resolver, modes]
  );

  if (!config) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          The surfaces helper derives foregrounds, borders and state variants from
          each surface color — APCA-targeted, per mode.
        </p>
        <Button
          size="sm"
          onClick={() => {
            // Seed the DRAFT only — nothing touches the files until the
            // user hits Save (an accidental tab visit must not write).
            setDraft(seedConfig(modes));
            setPersistedAtEdit(persisted);
          }}
        >
          Enable surfaces helper
        </Button>
      </div>
    );
  }

  const update = (next: SurfacesConfig) => {
    setDraft(next);
    if (!dirty) setPersistedAtEdit(persisted);
  };

  const patchSurface = (id: string, patch: Partial<SurfaceRow>) =>
    update({
      ...config,
      surfaces: config.surfaces.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });

  const moveSurface = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= config.surfaces.length) return;
    const next = [...config.surfaces];
    [next[index], next[j]] = [next[j], next[index]];
    update({ ...config, surfaces: next });
  };

  const previewSurface =
    config.surfaces.find((s) => s.id === previewSurfaceId) ?? config.surfaces[0] ?? null;

  const pageBgByMode: Record<string, string | undefined> = {};
  const pageBgSurface =
    config.surfaces.find((s) =>
      /^(bg|background|base|page|surface|default)$/i.test(s.name)
    ) ?? config.surfaces[0];
  if (pageBgSurface) {
    const expanded = expandSurfaceModes(pageBgSurface, modes);
    for (const mode of modes) {
      pageBgByMode[mode] =
        resolveSurfaceBaseHex(expanded.baseByMode[mode], mode, resolveBaseHex) ?? undefined;
    }
  }

  const bareCount = config.surfaces.filter((s) => s.bareLevels).length;
  const surfaceGrid = `1.5rem 9rem repeat(${modes.length * 2}, minmax(0, 1fr)) 4rem`;

  return (
    <div className="space-y-8">
      {/* ===== SURFACES ===== */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Surfaces
          </h3>
          {bareCount > 1 && (
            <span className="text-[10px] text-amber-600">
              {bareCount} bare surfaces — later ones overwrite level tokens
            </span>
          )}
          {dirty && (
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                className="h-7"
                onClick={async () => {
                  await actions.updateSurfacesConfig({
                    collection: collection.name,
                    config,
                  });
                  setDraft(config);
                  setPersistedAtEdit(config);
                }}
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={() => {
                  setDraft(persisted ?? null);
                  setPersistedAtEdit(persisted);
                }}
              >
                Discard
              </Button>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-8"
            onClick={() =>
              update({
                ...config,
                surfaces: [
                  ...config.surfaces,
                  {
                    id: uid(),
                    name: `surface-${config.surfaces.length + 1}`,
                    materializeBase: true,
                    baseByMode: Object.fromEntries(
                      modes.map((m) => [
                        m,
                        { kind: "raw", value: "#dddddd" } as SurfaceBaseValue,
                      ])
                    ),
                  },
                ],
              })
            }
          >
            <Plus className="h-3.5 w-3.5" /> Add surface
          </Button>
        </div>

        <div className="overflow-hidden rounded-lg border">
          {/* header band */}
          <div
            className="grid items-center gap-2 bg-muted/40 px-2 py-1.5"
            style={{ gridTemplateColumns: surfaceGrid }}
          >
            <span />
            <span className="text-[11px] font-medium text-muted-foreground">Name</span>
            {modes.map((mode, i) => (
              <div key={mode} className="col-span-2">
                <ModeHeader
                  name={mode}
                  index={i}
                  total={modes.length}
                  collection={collection}
                />
              </div>
            ))}
            <span />
          </div>

          {config.surfaces.map((surface, index) => {
            const expanded = expandSurfaceModes(surface, modes);
            return (
              <div
                key={surface.id}
                className="grid items-center gap-2 border-t px-2 py-2"
                style={{ gridTemplateColumns: surfaceGrid }}
              >
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => moveSurface(index, -1)}
                    className="text-muted-foreground/60 hover:text-foreground disabled:opacity-20"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={index === config.surfaces.length - 1}
                    onClick={() => moveSurface(index, 1)}
                    className="text-muted-foreground/60 hover:text-foreground disabled:opacity-20"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                <Input
                  value={surface.name}
                  onChange={(e) => patchSurface(surface.id, { name: e.target.value })}
                  className="h-8 font-mono text-xs"
                />
                {modes.map((mode) => {
                  const explicitBase = surface.baseByMode[mode] !== undefined;
                  const explicitFg = surface.fgByMode?.[mode] !== undefined;
                  const inheritedBase = mode !== primary && !explicitBase;
                  const inheritedFg = mode !== primary && !explicitFg;
                  const baseHex = resolveSurfaceBaseHex(
                    expanded.baseByMode[mode],
                    mode,
                    resolveBaseHex
                  );
                  const autoFg: "light" | "dark" | null = baseHex
                    ? hexToOklch(baseHex).l < threshold
                      ? "light"
                      : "dark"
                    : null;
                  return (
                    <Fragment key={mode}>
                      <BaseCell
                        value={expanded.baseByMode[mode]}
                        mode={mode}
                        inherited={inheritedBase}
                        resolveBaseHex={resolveBaseHex}
                        onChange={(base) =>
                          patchSurface(surface.id, {
                            baseByMode: { ...surface.baseByMode, [mode]: base },
                          })
                        }
                        onReset={
                          mode !== primary && explicitBase
                            ? () => {
                                const { [mode]: _, ...rest } = surface.baseByMode;
                                patchSurface(surface.id, { baseByMode: rest });
                              }
                            : undefined
                        }
                      />
                      <FgPicker
                        fg={expanded.fgByMode?.[mode] ?? { kind: "auto" }}
                        autoFg={autoFg}
                        mode={mode}
                        inherited={inheritedFg}
                        resolveBaseHex={resolveBaseHex}
                        onChange={(fg) =>
                          patchSurface(surface.id, {
                            fgByMode: { ...(surface.fgByMode ?? {}), [mode]: fg },
                          })
                        }
                        onReset={
                          mode !== primary && explicitFg
                            ? () => {
                                const { [mode]: _, ...rest } = surface.fgByMode ?? {};
                                patchSurface(surface.id, { fgByMode: rest });
                              }
                            : undefined
                        }
                      />
                    </Fragment>
                  );
                })}
                <div className="flex items-center justify-end gap-0.5">
                  <DropdownMenu>
                    <DropdownMenuTrigger className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent">
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <div className="flex items-center justify-between px-2 py-1.5 text-xs">
                        <span title="Emit the surface base itself as a token">
                          Materialize base
                        </span>
                        <Switch
                          checked={surface.materializeBase ?? false}
                          onCheckedChange={(materializeBase) =>
                            patchSurface(surface.id, { materializeBase })
                          }
                        />
                      </div>
                      <div className="flex items-center justify-between px-2 py-1.5 text-xs">
                        <span title="Drop the surface prefix on level tokens (fg instead of bg.fg)">
                          Bare levels
                        </span>
                        <Switch
                          checked={surface.bareLevels ?? false}
                          onCheckedChange={(bareLevels) =>
                            patchSurface(surface.id, { bareLevels })
                          }
                        />
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <button
                    type="button"
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive"
                    title="Delete surface"
                    onClick={() =>
                      update({
                        ...config,
                        surfaces: config.surfaces.filter((s) => s.id !== surface.id),
                      })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ===== MATRIX ===== */}
      <MatrixSection
        config={config}
        modes={modes}
        threshold={threshold}
        resolveBaseHex={resolveBaseHex}
        resolveScaleStep={resolveScaleStep}
        pageBgByMode={pageBgByMode}
        onPatchSurface={patchSurface}
      />

      {/* ===== RULES ===== */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Rules
          </h3>
          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              Preview:
              <Select
                value={previewSurface?.id ?? ""}
                onValueChange={(v) => v && setPreviewSurfaceId(v)}
              >
                <SelectTrigger className="h-7 w-32 text-xs">
                  <SelectValue>{previewSurface?.name ?? "…"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {config.surfaces.map((s) => (
                    <SelectItem key={s.id} value={s.id} className="font-mono text-xs">
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs font-medium transition hover:bg-accent">
                <Plus className="h-3.5 w-3.5" /> Add rule
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(Object.keys(RULE_KIND_LABELS) as SurfaceLevelRule["kind"][]).map(
                  (kind) => {
                    const KIcon = RULE_KIND_ICONS[kind];
                    return (
                      <DropdownMenuItem
                        key={kind}
                        className="text-xs"
                        onClick={() =>
                          update({
                            ...config,
                            levels: [...config.levels, defaultLevelForKind(kind)],
                          })
                        }
                      >
                        <KIcon className="h-3 w-3" /> {RULE_KIND_LABELS[kind]}
                      </DropdownMenuItem>
                    );
                  }
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border">
          <div className="grid grid-cols-[1.5rem_2.25rem_9rem_1fr_1fr_3.5rem] items-center gap-2 bg-muted/40 px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
            <span />
            <span>Type</span>
            <span>Name</span>
            <span>{modes[0] ?? "light"} mode</span>
            <span>{modes[1] ?? "dark"} mode</span>
            <span />
          </div>
          {config.levels.map((level, i) => (
            <RuleRow
              key={level.id}
              level={level}
              levels={config.levels}
              previewSurface={previewSurface}
              modes={modes}
              threshold={threshold}
              resolveBaseHex={resolveBaseHex}
              resolveScaleStep={resolveScaleStep}
              pageBgByMode={pageBgByMode}
              canMoveUp={i > 0}
              canMoveDown={i < config.levels.length - 1}
              onChange={(next) =>
                update({
                  ...config,
                  levels: config.levels.map((l) => (l.id === next.id ? next : l)),
                })
              }
              onMove={(dir) => {
                const j = i + dir;
                const next = [...config.levels];
                [next[i], next[j]] = [next[j], next[i]];
                update({ ...config, levels: next });
              }}
              onRemove={() =>
                update({
                  ...config,
                  levels: config.levels.filter((l) => l.id !== level.id),
                })
              }
            />
          ))}
        </div>
      </section>

      {/* ===== PREVIEW ===== */}
      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Preview{dirty ? " (unsaved)" : ""}
        </h3>
        <SurfacesPreview config={config} modes={modes} />
      </section>
    </div>
  );
}
