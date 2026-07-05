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
import { Link as LinkIcon, Unlink } from "lucide-react";
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
import type { CollectionDoc, CompositeLayer, TokenDoc, TokenValue } from "@core/types";
import { useActions, useCollections } from "@/lib/store";
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
  return (
    <div className="space-y-1.5 rounded-md border p-2">
      {SLOTS.map((slot) => {
        const v = layer[slot];
        return (
          <div key={slot} className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-[11px] text-muted-foreground">{slot}</span>
            {v?.type === "alias" ? (
              <>
                <span className="flex-1 truncate rounded bg-purple-100 px-1.5 py-1 font-mono text-xs text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                  {v.token}
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
                  {value?.type === "composite" && !Array.isArray(value.layers) ? (
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
