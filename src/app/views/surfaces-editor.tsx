/**
 * SurfacesEditorView — the surfaces/themes helper.
 *
 * Functional port of the cloud product's surfaces editor: a surfaces ×
 * modes table (base + fg per cell), a levels list (fg APCA/mix,
 * surface-shift, surface-mix, opacity, scale-step) and a live preview
 * materialized CLIENT-side with the same core the server uses — so you
 * see the result before saving. Save persists the whole config
 * (`actions.updateSurfacesConfig`) and the server rematerializes.
 *
 * Simplifications vs the cloud editor (follow-ups): onLight/onDark
 * branches edit together (linked), no per-cell level overrides UI
 * (levelStates), no measureAgainst UI. The schema supports them all —
 * they're editable in the files.
 */

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import { TailwindColorCommandGroup } from "@/components/tailwind-color-picker";
import {
  generateSurfaceTokens,
  makeResolveScaleStep,
  resolveSurfaceBaseHex,
  type SurfaceBaseValue,
  type SurfaceFgChoice,
  type SurfaceLevel,
  type SurfaceLevelRule,
  type SurfaceRow,
  type SurfacesConfig,
} from "@core/surfaces-utils";
import type { CollectionDoc } from "@core/types";
import { useActions, useSystem } from "@/lib/store";
import { useResolver } from "@/lib/resolver";
import { cn } from "@/lib/utils";

const uid = () => Math.random().toString(36).slice(2, 10);

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
    contrastThreshold: 0.6,
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

function defaultLevel(kind: SurfaceLevelRule["kind"]): SurfaceLevel {
  const id = uid();
  switch (kind) {
    case "fg":
      return {
        id,
        name: "level",
        rule: {
          kind,
          onLight: { target: { kind: "apca", lc: 75 }, anchor: { kind: "auto" } },
          onDark: { target: { kind: "apca", lc: 75 }, anchor: { kind: "auto" } },
        },
      };
    case "surface-shift":
      return {
        id,
        name: "hover",
        display: "bg",
        rule: { kind, onLight: { stepStrength: 0.4 }, onDark: { stepStrength: 0.4 } },
      };
    case "surface-mix":
      return {
        id,
        name: "mix",
        display: "bg",
        rule: {
          kind,
          onLight: { mix: 0.6, anchor: { kind: "auto" } },
          onDark: { mix: 0.6, anchor: { kind: "auto" } },
        },
      };
    case "opacity":
      return {
        id,
        name: "disabled",
        rule: {
          kind,
          source: "fg",
          bake: "alpha",
          onLight: { alpha: 0.4 },
          onDark: { alpha: 0.4 },
        },
      };
    case "scale-step":
      return {
        id,
        name: "soft",
        display: "bg",
        rule: { kind, onLight: { step: "100" }, onDark: { step: "900" } },
      };
  }
}

// ============================================================================
// BASE CELL — raw hex / alias / tailwind (as 0-op derivation)
// ============================================================================

function BaseCell({
  value,
  mode,
  useTailwind,
  onChange,
}: {
  value: SurfaceBaseValue | undefined;
  mode: string;
  useTailwind: boolean;
  onChange: (next: SurfaceBaseValue) => void;
}) {
  const resolver = useResolver();
  const [open, setOpen] = useState(false);

  const hex = useMemo(
    () =>
      resolveSurfaceBaseHex(value, mode, (ref, m) =>
        resolver.resolveRaw(ref, m)
      ) ?? "#ffffff",
    [value, mode, resolver]
  );

  const label =
    value?.kind === "alias"
      ? value.token
      : value?.kind === "derived"
        ? value.base.kind === "tailwind"
          ? `tw:${value.base.color}`
          : `derived`
        : hex;

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <ColorPickerPopover
        value={hex}
        onChange={(next) => onChange({ kind: "raw", value: next })}
        swatchClassName="h-6 w-6"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className={cn(
            "h-7 min-w-0 flex-1 truncate rounded px-1.5 text-left font-mono text-xs transition hover:bg-accent",
            value?.kind === "alias" &&
              "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
            value?.kind === "derived" &&
              "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300"
          )}
        >
          {label}
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search color tokens…" />
            <CommandList>
              <CommandEmpty>No tokens found.</CommandEmpty>
              <CommandGroup heading="Tokens">
                {resolver.aliasOptions([mode]).map((o) => (
                  <CommandItem
                    key={o.name}
                    value={o.name}
                    onSelect={() => {
                      onChange({ kind: "alias", token: o.name });
                      setOpen(false);
                    }}
                    className="text-xs"
                  >
                    {o.resolvedValue?.startsWith("#") && (
                      <span
                        className="h-3 w-3 shrink-0 rounded border"
                        style={{ background: o.resolvedValue }}
                      />
                    )}
                    <span className="ml-1 truncate font-mono">{o.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              {useTailwind && (
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
    </div>
  );
}

// ============================================================================
// LEVEL ROW — kind + linked-branch params
// ============================================================================

function LevelRow({
  level,
  onChange,
  onRemove,
}: {
  level: SurfaceLevel;
  onChange: (next: SurfaceLevel) => void;
  onRemove: () => void;
}) {
  const rule = level.rule;

  // Linked-branch editing: write the same patch to onLight and onDark.
  const patchBoth = (patch: object) =>
    onChange({
      ...level,
      rule: {
        ...rule,
        onLight: { ...rule.onLight, ...patch },
        onDark: { ...rule.onDark, ...patch },
      } as SurfaceLevelRule,
    });

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5">
      <Input
        value={level.name}
        onChange={(e) => onChange({ ...level, name: e.target.value })}
        className="h-7 w-28 font-mono text-xs"
      />
      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
        {rule.kind}
      </span>

      {rule.kind === "fg" && "target" in rule.onLight && (
        <>
          <Select
            value={rule.onLight.target.kind}
            onValueChange={(k) =>
              patchBoth({
                target:
                  k === "apca"
                    ? { kind: "apca", lc: 75 }
                    : { kind: "mix", mix: 0.7 },
              })
            }
          >
            <SelectTrigger className="h-7 w-20 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="apca" className="text-xs">APCA</SelectItem>
              <SelectItem value="mix" className="text-xs">mix</SelectItem>
            </SelectContent>
          </Select>
          {rule.onLight.target.kind === "apca" ? (
            <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
              Lc
              <Input
                type="number"
                min={0}
                max={108}
                value={rule.onLight.target.lc}
                onChange={(e) =>
                  patchBoth({
                    target: { kind: "apca", lc: Number(e.target.value) },
                  })
                }
                className="h-7 w-16 text-xs"
              />
            </label>
          ) : (
            <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
              mix
              <Input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={rule.onLight.target.mix}
                onChange={(e) =>
                  patchBoth({
                    target: { kind: "mix", mix: Number(e.target.value) },
                  })
                }
                className="h-7 w-16 text-xs"
              />
            </label>
          )}
        </>
      )}

      {rule.kind === "surface-shift" && (
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          step
          <Input
            type="number"
            min={-1}
            max={1}
            step={0.05}
            value={rule.onLight.stepStrength ?? 0}
            onChange={(e) => patchBoth({ stepStrength: Number(e.target.value) })}
            className="h-7 w-16 text-xs"
          />
        </label>
      )}

      {rule.kind === "surface-mix" && (
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          mix
          <Input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={rule.onLight.mix}
            onChange={(e) => patchBoth({ mix: Number(e.target.value) })}
            className="h-7 w-16 text-xs"
          />
        </label>
      )}

      {rule.kind === "opacity" && (
        <>
          <Select
            value={typeof rule.source === "string" ? rule.source : "alias"}
            onValueChange={(source) =>
              onChange({
                ...level,
                rule: { ...rule, source: source as "fg" | "surface" },
              })
            }
          >
            <SelectTrigger className="h-7 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fg" className="text-xs">fg</SelectItem>
              <SelectItem value="surface" className="text-xs">surface</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            α
            <Input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={rule.onLight.alpha}
              onChange={(e) => patchBoth({ alpha: Number(e.target.value) })}
              className="h-7 w-16 text-xs"
            />
          </label>
        </>
      )}

      {rule.kind === "scale-step" && (
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          step
          <Input
            value={rule.onLight.step}
            onChange={(e) => patchBoth({ step: e.target.value.trim() })}
            className="h-7 w-16 font-mono text-xs"
          />
        </label>
      )}

      <Select
        value={level.display ?? "text"}
        onValueChange={(display) =>
          onChange({
            ...level,
            display: display as SurfaceLevel["display"],
          })
        }
      >
        <SelectTrigger className="ml-auto h-7 w-24 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="text" className="text-xs">text</SelectItem>
          <SelectItem value="separator" className="text-xs">separator</SelectItem>
          <SelectItem value="bg" className="text-xs">bg</SelectItem>
        </SelectContent>
      </Select>
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onRemove}>
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

// ============================================================================
// PREVIEW — live client-side materialization of the DRAFT config
// ============================================================================

function SurfacesPreview({
  config,
  modes,
}: {
  config: SurfacesConfig;
  modes: string[];
}) {
  const resolver = useResolver();
  const tokens = useMemo(() => {
    try {
      const aliasOptions = resolver.aliasOptions(modes);
      return generateSurfaceTokens(
        config,
        modes,
        (ref, mode) => resolver.resolveRaw(ref, mode),
        { resolveScaleStep: makeResolveScaleStep(aliasOptions) }
      );
    } catch {
      return [];
    }
  }, [config, modes, resolver]);

  const byName = useMemo(
    () => new Map(tokens.map((t) => [t.name, t])),
    [tokens]
  );

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {config.surfaces.map((surface) => {
        if (!surface.name.trim()) return null;
        const levelsFor = config.levels.filter((l) => {
          const state = surface.levelStates?.[l.id] ?? surface.levelStates?.["*"];
          return state?.state !== "disabled";
        });
        return (
          <div key={surface.id} className="overflow-hidden rounded-md border">
            <div className="bg-muted/40 px-2 py-1 font-mono text-xs">
              {surface.name}
              {surface.bareLevels && (
                <span className="ml-2 text-[10px] text-muted-foreground">
                  (bare)
                </span>
              )}
            </div>
            <div
              className="grid"
              style={{ gridTemplateColumns: `repeat(${modes.length}, 1fr)` }}
            >
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
                    <div className="pb-1 font-mono text-[10px] opacity-50">
                      {mode}
                    </div>
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

export function SurfacesEditorView({
  collection,
}: {
  collection: CollectionDoc;
}) {
  const actions = useActions();
  const system = useSystem();
  const persisted = collection.surfacesConfig as SurfacesConfig | undefined;
  const [draft, setDraft] = useState<SurfacesConfig | null>(persisted ?? null);
  const [persistedAtEdit, setPersistedAtEdit] = useState(persisted);

  // External change while not dirty → follow the store.
  const dirty =
    draft !== null &&
    JSON.stringify(draft) !== JSON.stringify(persistedAtEdit ?? null);
  const config = dirty ? draft : (persisted ?? draft);

  if (!config) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          The surfaces helper derives foregrounds, borders and state
          variants from each surface color — APCA-targeted, per mode.
        </p>
        <Button
          size="sm"
          onClick={() => {
            const seeded = seedConfig(collection.modes);
            setDraft(seeded);
            setPersistedAtEdit(persisted);
            void actions.updateSurfacesConfig({
              collection: collection.name,
              config: seeded,
            });
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
      surfaces: config.surfaces.map((s) =>
        s.id === id ? { ...s, ...patch } : s
      ),
    });

  return (
    <div className="space-y-5">
      {/* Save bar */}
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">Surfaces</h2>
        {dirty && (
          <>
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
          </>
        )}
      </div>

      {/* Surfaces table */}
      <div className="space-y-2">
        {config.surfaces.map((surface) => (
          <div
            key={surface.id}
            className="flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5"
          >
            <Input
              value={surface.name}
              onChange={(e) => patchSurface(surface.id, { name: e.target.value })}
              className="h-7 w-36 font-mono text-xs"
            />
            {collection.modes.map((mode) => (
              <div key={mode} className="flex min-w-40 flex-1 items-center gap-1">
                <span className="w-10 shrink-0 text-[10px] text-muted-foreground">
                  {mode}
                </span>
                <BaseCell
                  value={surface.baseByMode[mode]}
                  mode={mode}
                  useTailwind={system?.useTailwindColors ?? false}
                  onChange={(base) =>
                    patchSurface(surface.id, {
                      baseByMode: { ...surface.baseByMode, [mode]: base },
                    })
                  }
                />
                <Select
                  value={surface.fgByMode?.[mode]?.kind ?? "auto"}
                  onValueChange={(k) =>
                    patchSurface(surface.id, {
                      fgByMode: {
                        ...(surface.fgByMode ?? {}),
                        [mode]: { kind: k } as SurfaceFgChoice,
                      },
                    })
                  }
                >
                  <SelectTrigger className="h-7 w-[4.5rem] text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto" className="text-xs">auto</SelectItem>
                    <SelectItem value="light" className="text-xs">light</SelectItem>
                    <SelectItem value="dark" className="text-xs">dark</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
            <label
              className="flex items-center gap-1 text-[10px] text-muted-foreground"
              title="Emit the surface base itself as a token"
            >
              base
              <Switch
                checked={surface.materializeBase ?? false}
                onCheckedChange={(materializeBase) =>
                  patchSurface(surface.id, { materializeBase })
                }
              />
            </label>
            <label
              className="flex items-center gap-1 text-[10px] text-muted-foreground"
              title="Drop the surface prefix on level tokens (fg instead of bg.fg)"
            >
              bare
              <Switch
                checked={surface.bareLevels ?? false}
                onCheckedChange={(bareLevels) =>
                  patchSurface(surface.id, { bareLevels })
                }
              />
            </label>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() =>
                update({
                  ...config,
                  surfaces: config.surfaces.filter((s) => s.id !== surface.id),
                })
              }
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
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
                    collection.modes.map((m) => [
                      m,
                      { kind: "raw", value: "#dddddd" } as SurfaceBaseValue,
                    ])
                  ),
                },
              ],
            })
          }
        >
          <Plus className="h-3 w-3" /> Add surface
        </Button>
      </div>

      {/* Levels */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Levels
        </h3>
        {config.levels.map((level) => (
          <LevelRow
            key={level.id}
            level={level}
            onChange={(next) =>
              update({
                ...config,
                levels: config.levels.map((l) => (l.id === next.id ? next : l)),
              })
            }
            onRemove={() =>
              update({
                ...config,
                levels: config.levels.filter((l) => l.id !== level.id),
              })
            }
          />
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-1 rounded-md border border-dashed px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-accent">
            <Plus className="h-3 w-3" /> Add level
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {(
              [
                ["fg", "Foreground (APCA)"],
                ["surface-shift", "Surface variation"],
                ["surface-mix", "Ink mix"],
                ["opacity", "Opacity"],
                ["scale-step", "Scale step"],
              ] as const
            ).map(([kind, label]) => (
              <DropdownMenuItem
                key={kind}
                className="text-xs"
                onClick={() =>
                  update({
                    ...config,
                    levels: [...config.levels, defaultLevel(kind)],
                  })
                }
              >
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Live preview of the draft */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Preview{dirty ? " (unsaved)" : ""}
        </h3>
        <SurfacesPreview config={config} modes={collection.modes} />
      </div>
    </div>
  );
}
