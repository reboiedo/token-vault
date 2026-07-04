/**
 * Derivation editor — author a derived color: pick a base (token /
 * tailwind / raw hex), stack OKLCH ops, live-preview the result.
 * Controlled: `initial` seeds the dialog, `onSave(base, ops)` persists.
 * Name-based port of the cloud product's derivation-editor.
 */

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { ColorPickerPopover } from "./color-picker-popover";
import { TailwindColorPopover } from "./tailwind-color-picker";
import { resolveDerivationToHex } from "@core/derivation";
import { getTailwindHex } from "@core/tailwind-colors";
import type { DerivationBase, DerivationOp, TokenRef } from "@core/types";
import { useResolver } from "@/lib/resolver";
import { cn } from "@/lib/utils";

function TokenRefPicker({
  value,
  onChange,
  placeholder = "Pick a token…",
}: {
  value: TokenRef | null;
  onChange: (ref: TokenRef) => void;
  placeholder?: string;
}) {
  const resolver = useResolver();
  const options = useMemo(() => resolver.aliasOptions([]), [resolver]);
  const [open, setOpen] = useState(false);
  const hex = value ? resolver.resolveRaw(value) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-mono hover:bg-accent transition min-w-0"
        )}
      >
        {hex && (
          <span
            className="h-3.5 w-3.5 rounded border shrink-0"
            style={{ background: hex }}
          />
        )}
        <span className="truncate">{value ?? placeholder}</span>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search tokens…" />
          <CommandList>
            <CommandEmpty>No tokens found.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.name}
                  value={o.name}
                  onSelect={() => {
                    onChange(o.name);
                    setOpen(false);
                  }}
                  className="text-xs"
                >
                  {o.resolvedValue?.startsWith("#") && (
                    <span
                      className="h-3 w-3 rounded border shrink-0"
                      style={{ background: o.resolvedValue }}
                    />
                  )}
                  <span className="ml-1 font-mono truncate">{o.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const OP_LABELS: Record<DerivationOp["op"], string> = {
  lighten: "Lighten",
  darken: "Darken",
  mute: "Mute",
  mix: "Mix with",
  autoContrast: "Auto contrast",
  shift: "Shift",
};

function defaultOp(op: DerivationOp["op"]): DerivationOp {
  switch (op) {
    case "lighten":
      return { op, amount: 0.1 };
    case "darken":
      return { op, amount: 0.1 };
    case "mute":
      return { op, amount: 0.3 };
    case "mix":
      return { op, with: "", weight: 0.3 };
    case "autoContrast":
      return { op };
    case "shift":
      return { op, stepStrength: 0.4 };
  }
}

function NumberField({
  label,
  value,
  step = 0.05,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      {label}
      <Input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-7 w-20 text-xs"
      />
    </label>
  );
}

export function DerivationEditor({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: { base: DerivationBase; ops: DerivationOp[] };
  onSave: (base: DerivationBase, ops: DerivationOp[]) => void | Promise<void>;
}) {
  const [base, setBase] = useState<DerivationBase>(initial.base);
  const [ops, setOps] = useState<DerivationOp[]>(initial.ops);
  const resolver = useResolver();

  const previewHex = useMemo(() => {
    try {
      return resolveDerivationToHex(base, ops, (ref) =>
        resolver.resolveRaw(ref)
      );
    } catch {
      return null;
    }
  }, [base, ops, resolver]);

  const patchOp = (i: number, next: DerivationOp) =>
    setOps(ops.map((o, j) => (j === i ? next : o)));
  const moveOp = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= ops.length) return;
    const next = [...ops];
    [next[i], next[j]] = [next[j], next[i]];
    setOps(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Derive color</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Base */}
          <div className="flex items-center gap-2">
            <Select
              value={base.kind}
              onValueChange={(k) => {
                if (k === "token") setBase({ kind: "token", token: "" });
                else if (k === "tailwind")
                  setBase({ kind: "tailwind", color: "slate-500" });
                else setBase({ kind: "raw", value: "#3b82f6" });
              }}
            >
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="token">Existing token</SelectItem>
                <SelectItem value="tailwind">Tailwind color</SelectItem>
                <SelectItem value="raw">Hex literal</SelectItem>
              </SelectContent>
            </Select>
            {base.kind === "token" && (
              <TokenRefPicker
                value={base.token || null}
                onChange={(token) => setBase({ kind: "token", token })}
              />
            )}
            {base.kind === "tailwind" && (
              <TailwindColorPopover
                onSelect={(color) => setBase({ kind: "tailwind", color })}
              >
                <button
                  type="button"
                  className="flex h-8 items-center gap-1.5 rounded-md border px-2 font-mono text-xs hover:bg-accent transition"
                >
                  <span
                    className="h-3.5 w-3.5 rounded border shrink-0"
                    style={{
                      background: getTailwindHex(base.color) ?? "transparent",
                    }}
                  />
                  {base.color}
                </button>
              </TailwindColorPopover>
            )}
            {base.kind === "raw" && (
              <ColorPickerPopover
                value={base.value}
                onChange={(value) => setBase({ kind: "raw", value })}
                swatchClassName="h-8 w-8"
              />
            )}
          </div>

          {/* Ops pipeline */}
          <div className="space-y-1.5">
            {ops.map((op, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-md border px-2 py-1.5"
              >
                <span className="w-24 shrink-0 text-xs font-medium">
                  {OP_LABELS[op.op]}
                </span>
                <div className="flex flex-1 flex-wrap items-center gap-2 min-w-0">
                  {(op.op === "lighten" ||
                    op.op === "darken" ||
                    op.op === "mute") && (
                    <NumberField
                      label="amount"
                      value={op.amount}
                      min={0}
                      max={1}
                      onChange={(amount) => patchOp(i, { ...op, amount })}
                    />
                  )}
                  {op.op === "mix" && (
                    <>
                      <TokenRefPicker
                        value={op.with || null}
                        onChange={(ref) => patchOp(i, { ...op, with: ref })}
                      />
                      <NumberField
                        label="weight"
                        value={op.weight}
                        min={0}
                        max={1}
                        onChange={(weight) => patchOp(i, { ...op, weight })}
                      />
                    </>
                  )}
                  {op.op === "shift" && (
                    <>
                      <NumberField
                        label="step"
                        value={op.stepStrength}
                        min={-1}
                        max={1}
                        onChange={(stepStrength) =>
                          patchOp(i, { ...op, stepStrength })
                        }
                      />
                      <NumberField
                        label="ΔC"
                        value={op.chromaDelta ?? 0}
                        step={0.01}
                        onChange={(chromaDelta) =>
                          patchOp(i, {
                            ...op,
                            chromaDelta: chromaDelta || undefined,
                          })
                        }
                      />
                    </>
                  )}
                  {op.op === "autoContrast" && (
                    <span className="text-[11px] text-muted-foreground">
                      black/white by luminance
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => moveOp(i, -1)}
                  >
                    <ChevronUp className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => moveOp(i, 1)}
                  >
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setOps(ops.filter((_, j) => j !== i))}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
            <Select
              value=""
              onValueChange={(op) =>
                setOps([...ops, defaultOp(op as DerivationOp["op"])])
              }
            >
              <SelectTrigger className="h-8 w-40 text-xs">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Plus className="h-3 w-3" /> Add op
                </span>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(OP_LABELS) as DerivationOp["op"][]).map((op) => (
                  <SelectItem key={op} value={op} className="text-xs">
                    {OP_LABELS[op]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Preview */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Result</span>
            <span
              className="h-6 w-6 rounded border"
              style={{ background: previewHex ?? "transparent" }}
            />
            <code>{previewHex ?? "—"}</code>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={base.kind === "token" && !base.token}
            onClick={async () => {
              await onSave(base, ops);
              onOpenChange(false);
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
