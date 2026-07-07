/**
 * TokenEditorDialog — "Edit Details", port of the cloud's
 * token-editor-dialog.tsx: token name (dotted-grouping hint), one typed
 * value row per mode (color picker, number, fontWeight/boolean selects,
 * free text for the rest), a Link button per mode to convert raw ↔
 * alias, and the dedicated slot editor for `typography` composites.
 * Shadow / border / gradient / transition edit as plain text, exactly
 * like the cloud. Saves on change (auto-save semantics).
 */

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Link as LinkIcon,
  Plus,
  Trash2,
  Unlink,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ColorPickerPopover } from "./color-picker-popover";
import { Switch } from "@/components/ui/switch";
import { getTailwindHex } from "@core/tailwind-colors";
import {
  getTailwindUtility,
  tailwindScalesByNamespace,
  TAILWIND_SLOT_NAMESPACES,
} from "@core/tailwind-theme";
import {
  TailwindUtilityPopover,
  TailwindUtilityTrigger,
} from "./tailwind-utility-picker";
import { cn } from "@/lib/utils";
import type {
  CollectionDoc,
  CompositeLayer,
  CompositeSlot,
  TokenDoc,
  TokenValue,
} from "@core/types";
import { useActions, useCollections, useSystem } from "@/lib/store";
import { useResolver } from "@/lib/resolver";

const FONT_WEIGHTS = ["100", "200", "300", "400", "500", "600", "700", "800", "900"];

function AliasPicker({
  mode,
  selfName,
  onPick,
  children,
}: {
  mode: string;
  selfName: string;
  onPick: (name: string) => void;
  children: React.ReactElement;
}) {
  const collections = useCollections();
  const resolver = useResolver();
  const [open, setOpen] = useState(false);
  const groups = useMemo(
    () =>
      collections
        .map((c) => ({
          collection: c.name,
          options: c.tokens
            .filter((t) => t.name !== selfName)
            .map((t) => ({
              name: t.name,
              preview: resolver.resolveRaw(t.name, mode) ?? "",
            })),
        }))
        .filter((g) => g.options.length),
    [collections, resolver, mode, selfName]
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={children} />
      <PopoverContent className="w-72 p-0" align="end">
        <Command>
          <CommandInput placeholder="Link to token…" />
          <CommandList>
            <CommandEmpty>No tokens found.</CommandEmpty>
            {groups.map((g) => (
              <CommandGroup key={g.collection} heading={g.collection}>
                {g.options.map((o) => (
                  <CommandItem
                    key={o.name}
                    value={o.name}
                    className="text-xs"
                    onSelect={() => {
                      onPick(o.name);
                      setOpen(false);
                    }}
                  >
                    {o.preview.startsWith("#") && (
                      <span className="h-3 w-3 shrink-0 rounded border" style={{ background: o.preview }} />
                    )}
                    <span className="ml-1 truncate font-mono">{o.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function RawValueInput({
  token,
  value,
  onChange,
}: {
  token: TokenDoc;
  value: TokenValue & { type: "raw" };
  onChange: (v: string | number | boolean) => void;
}) {
  const s = String(value.value);
  switch (token.type) {
    case "color":
      return (
        <span className="flex flex-1 items-center gap-1.5">
          <ColorPickerPopover value={s} onChange={onChange} swatchClassName="h-7 w-7" />
          <Input value={s} onChange={(e) => onChange(e.target.value)} className="h-8 flex-1 font-mono text-xs" />
        </span>
      );
    case "number":
      return (
        <Input
          type="number"
          step="any"
          value={typeof value.value === "number" ? value.value : s}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-8 flex-1 font-mono text-xs"
        />
      );
    case "fontWeight":
      return (
        <Select value={s} onValueChange={(v) => v && onChange(Number(v))}>
          <SelectTrigger className="h-8 flex-1 text-xs">
            <SelectValue>{s}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {FONT_WEIGHTS.map((w) => (
              <SelectItem key={w} value={w} className="text-xs">
                {w}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "boolean":
      return (
        <Select value={s} onValueChange={(v) => v && onChange(v === "true")}>
          <SelectTrigger className="h-8 flex-1 text-xs">
            <SelectValue>{s}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true" className="text-xs">true</SelectItem>
            <SelectItem value="false" className="text-xs">false</SelectItem>
          </SelectContent>
        </Select>
      );
    default:
      // dimension / fontFamily / duration / cubicBezier / string /
      // shadow / border / gradient — plain text, like the cloud.
      return (
        <Input
          value={s}
          placeholder={`Enter ${token.type ?? "value"}`}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 flex-1 font-mono text-xs"
        />
      );
  }
}

/**
 * Layered-composite editor for shadow / gradient tokens (each layer is
 * a slot map; DTCG exports the array form). Goes beyond the cloud,
 * which only offered plain-text editing for these types.
 */
const LAYER_SLOTS: Record<string, string[]> = {
  shadow: ["color", "offsetX", "offsetY", "blur", "spread"],
  gradient: ["color", "position"],
};

function layerPreviewCss(
  type: string | undefined,
  layers: CompositeLayer[],
  resolve: (ref: string) => string | null
): React.CSSProperties {
  const val = (slot: CompositeSlot | undefined, fallback: string) =>
    slot === undefined
      ? fallback
      : slot.type === "alias"
        ? (resolve(slot.token) ?? fallback)
        : slot.type === "tailwind"
          ? (getTailwindHex(slot.color) ?? getTailwindUtility(slot.color)?.value ?? fallback)
          : String(slot.value);
  if (type === "shadow") {
    return {
      boxShadow: layers
        .map(
          (l) =>
            `${l.inset && val(l.inset, "") === "true" ? "inset " : ""}${val(l.offsetX, "0px")} ${val(l.offsetY, "0px")} ${val(l.blur, "0px")} ${val(l.spread, "0px")} ${val(l.color, "#0003")}`
        )
        .join(", "),
    };
  }
  if (type === "gradient") {
    const stops = layers
      .map((l) => `${val(l.color, "#000")} ${Math.round(Number(val(l.position, "0")) * 100)}%`)
      .join(", ");
    return { background: `linear-gradient(90deg, ${stops})` };
  }
  return {};
}

function LayersEditor({
  token,
  mode,
  layers,
  onLayers,
}: {
  token: TokenDoc;
  mode: string;
  layers: CompositeLayer[];
  onLayers: (next: CompositeLayer[]) => void;
}) {
  const resolver = useResolver();
  const slots = LAYER_SLOTS[token.type ?? ""] ?? Object.keys(layers[0] ?? {});
  const isShadow = token.type === "shadow";

  const patchLayer = (i: number, slot: string, next: CompositeSlot) =>
    onLayers(layers.map((l, j) => (j === i ? { ...l, [slot]: next } : l)));

  const moveLayer = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= layers.length) return;
    const next = [...layers];
    [next[i], next[j]] = [next[j], next[i]];
    onLayers(next);
  };

  return (
    <div className="space-y-2">
      {/* Live preview */}
      <div className="flex h-12 items-center justify-center rounded-md border bg-muted/20 p-2">
        <div
          className="h-8 w-40 rounded-md bg-background"
          style={layerPreviewCss(
            token.type,
            layers,
            (ref) => resolver.resolveRaw(ref, mode)
          )}
        />
      </div>

      {layers.map((layer, i) => (
        <div key={i} className="space-y-1.5 rounded-md border p-2">
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Layer {i + 1}
            </span>
            <div className="ml-auto flex items-center">
              <Button variant="ghost" size="icon" className="h-5 w-5" disabled={i === 0} onClick={() => moveLayer(i, -1)}>
                <ChevronUp className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                disabled={i === layers.length - 1}
                onClick={() => moveLayer(i, 1)}
              >
                <ChevronDown className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 hover:text-destructive"
                disabled={layers.length <= 1}
                onClick={() => onLayers(layers.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
          {slots.map((slot) => {
            const v = layer[slot];
            return (
              <div key={slot} className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-[11px] text-muted-foreground">{slot}</span>
                {v?.type === "alias" || v?.type === "tailwind" ? (
                  <>
                    <span
                      className={cn(
                        "flex-1 truncate rounded px-1.5 py-1 font-mono text-xs",
                        v.type === "alias"
                          ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
                          : "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300"
                      )}
                    >
                      {v.type === "alias" ? v.token : `tw:${v.color}`}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Unlink"
                      onClick={() =>
                        patchLayer(i, slot, {
                          type: "raw",
                          value:
                            v.type === "alias"
                              ? (resolver.resolveRaw(v.token, mode) ?? "")
                              : (getTailwindHex(v.color) ?? getTailwindUtility(v.color)?.value ?? ""),
                        })
                      }
                    >
                      <Unlink className="h-3 w-3" />
                    </Button>
                  </>
                ) : (
                  <>
                    {slot === "color" && (
                      <ColorPickerPopover
                        value={v ? String(v.value) : "#000000"}
                        onChange={(hex) => patchLayer(i, slot, { type: "raw", value: hex })}
                        swatchClassName="h-7 w-7"
                      />
                    )}
                    <Input
                      value={v !== undefined ? String(v.value) : ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const num = slot === "position" ? Number(raw) : NaN;
                        patchLayer(i, slot, {
                          type: "raw",
                          value: slot === "position" && Number.isFinite(num) ? num : raw,
                        });
                      }}
                      className="h-7 flex-1 font-mono text-xs"
                      placeholder={slot === "position" ? "0 – 1" : slot === "color" ? "#000000" : "0px"}
                    />
                    <AliasPicker
                      mode={mode}
                      selfName={token.name}
                      onPick={(name) => patchLayer(i, slot, { type: "alias", token: name })}
                    >
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Link to token">
                        <LinkIcon className="h-3 w-3" />
                      </Button>
                    </AliasPicker>
                  </>
                )}
              </div>
            );
          })}
          {isShadow && (
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-[11px] text-muted-foreground">inset</span>
              <Switch
                checked={layer.inset?.type === "raw" && layer.inset.value === true}
                onCheckedChange={(checked) => {
                  if (checked) patchLayer(i, "inset", { type: "raw", value: true });
                  else {
                    const { inset: _drop, ...rest } = layer;
                    onLayers(layers.map((l, j) => (j === i ? rest : l)));
                  }
                }}
              />
            </div>
          )}
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={() =>
          onLayers([
            ...layers,
            token.type === "gradient"
              ? { color: { type: "raw", value: "#8b5cf6" }, position: { type: "raw", value: 1 } }
              : {
                  color: { type: "raw", value: "#00000029" },
                  offsetX: { type: "raw", value: "0px" },
                  offsetY: { type: "raw", value: "2px" },
                  blur: { type: "raw", value: "6px" },
                  spread: { type: "raw", value: "0px" },
                },
          ])
        }
      >
        <Plus className="h-3 w-3" /> Add layer
      </Button>
    </div>
  );
}

function TypographySlots({
  token,
  mode,
  layer,
  onLayer,
}: {
  token: TokenDoc;
  mode: string;
  layer: CompositeLayer;
  onLayer: (next: CompositeLayer) => void;
}) {
  const SLOTS = ["fontFamily", "fontSize", "fontWeight", "letterSpacing", "lineHeight"];
  const system = useSystem();
  return (
    <div className="space-y-1.5 rounded-md border p-2">
      {SLOTS.map((slot) => {
        const v = layer[slot];
        const twScales = tailwindScalesByNamespace(TAILWIND_SLOT_NAMESPACES[slot] ?? []);
        return (
          <div key={slot} className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-[11px] text-muted-foreground">{slot}</span>
            {v?.type === "alias" || v?.type === "tailwind" ? (
              <>
                <span
                  className={cn(
                    "flex-1 truncate rounded px-1.5 py-1 font-mono text-xs",
                    v.type === "alias"
                      ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
                      : "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300"
                  )}
                >
                  {v.type === "alias" ? v.token : `tw:${v.color}`}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="Unlink"
                  onClick={() =>
                    onLayer({ ...layer, [slot]: { type: "raw", value: "" } })
                  }
                >
                  <Unlink className="h-3 w-3" />
                </Button>
              </>
            ) : (
              <>
                <Input
                  value={v ? String(v.value) : ""}
                  onChange={(e) =>
                    onLayer({ ...layer, [slot]: { type: "raw", value: e.target.value } })
                  }
                  className="h-7 flex-1 font-mono text-xs"
                />
                {system?.useTailwindColors && twScales.length > 0 && (
                  <TailwindUtilityPopover
                    scales={twScales}
                    onSelect={(ref) =>
                      onLayer({ ...layer, [slot]: { type: "tailwind", color: ref } })
                    }
                  >
                    <TailwindUtilityTrigger />
                  </TailwindUtilityPopover>
                )}
                <AliasPicker
                  mode={mode}
                  selfName={token.name}
                  onPick={(name) =>
                    onLayer({ ...layer, [slot]: { type: "alias", token: name } })
                  }
                >
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Link to token">
                    <LinkIcon className="h-3 w-3" />
                  </Button>
                </AliasPicker>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function TokenEditorDialog({
  open,
  onOpenChange,
  token,
  collection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: TokenDoc;
  collection: CollectionDoc;
}) {
  const actions = useActions();
  const [name, setName] = useState(token.name);

  const writeMode = (mode: string, next: TokenValue) =>
    void actions.updateToken({
      name: token.name,
      values: { ...token.values, [mode]: next },
    });

  const commitName = () => {
    const next = name.trim();
    if (next && next !== token.name) {
      void actions
        .renameToken({ name: token.name, newName: next })
        .catch((err) => {
          alert(String((err as Error).message));
          setName(token.name);
        });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Token</DialogTitle>
          <DialogDescription>
            {token.type ?? "token"} · {collection.modes.length} mode
            {collection.modes.length > 1 ? "s" : ""} — changes save
            immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => e.key === "Enter" && commitName()}
              className="font-mono text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              Use dots to group: <code>brand.accent</code>. References follow renames.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Values</Label>
            {collection.modes.map((mode) => {
              const value = token.values[mode];
              return (
                <div key={mode} className="space-y-1">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {mode}
                  </span>
                  {value?.type === "composite" && Array.isArray(value.layers) ? (
                    <LayersEditor
                      token={token}
                      mode={mode}
                      layers={value.layers}
                      onLayers={(layers) =>
                        writeMode(mode, { type: "composite", layers })
                      }
                    />
                  ) : value?.type === "composite" && !Array.isArray(value.layers) ? (
                    <TypographySlots
                      token={token}
                      mode={mode}
                      layer={value.layers}
                      onLayer={(layers) => writeMode(mode, { type: "composite", layers })}
                    />
                  ) : value?.type === "alias" ? (
                    <div className="flex items-center gap-2">
                      <span className="flex-1 truncate rounded bg-purple-100 px-1.5 py-1.5 font-mono text-xs text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                        {value.token}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Unlink"
                        onClick={() => writeMode(mode, { type: "raw", value: "" })}
                      >
                        <Unlink className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : value?.type === "raw" || value === undefined ? (
                    <div className="flex items-center gap-2">
                      <RawValueInput
                        token={token}
                        value={value ?? { type: "raw", value: "" }}
                        onChange={(v) => writeMode(mode, { type: "raw", value: v })}
                      />
                      <AliasPicker
                        mode={mode}
                        selfName={token.name}
                        onPick={(n) => writeMode(mode, { type: "alias", token: n })}
                      >
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Link to token">
                          <LinkIcon className="h-3.5 w-3.5" />
                        </Button>
                      </AliasPicker>
                    </div>
                  ) : (
                    <p className="rounded border px-2 py-1.5 text-[11px] text-muted-foreground">
                      {value.type} value — edit from the table cell.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
