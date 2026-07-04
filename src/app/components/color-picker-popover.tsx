/**
 * Minimal color picker: a swatch trigger opening a popover with the
 * native color input plus a hex field. (The cloud product uses a
 * fancier picker; this covers the same contract.)
 */

import { useEffect, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function ColorPickerPopover({
  value,
  onChange,
  swatchClassName,
}: {
  value: string;
  onChange: (hex: string) => void;
  swatchClassName?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = (next: string) => {
    if (/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(next)) onChange(next);
  };

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "rounded border border-neutral-300 shrink-0 h-6 w-6",
          swatchClassName
        )}
        style={{ background: value }}
        title={value}
      />
      <PopoverContent className="w-52 space-y-2 p-3" align="start">
        <input
          type="color"
          className="h-24 w-full cursor-pointer rounded border"
          value={/^#[0-9a-fA-F]{6}$/.test(draft) ? draft : "#000000"}
          onChange={(e) => {
            setDraft(e.target.value);
            commit(e.target.value);
          }}
        />
        <Input
          value={draft}
          className="h-8 font-mono text-xs"
          onChange={(e) => {
            setDraft(e.target.value);
            commit(e.target.value.trim());
          }}
          placeholder="#3b82f6"
        />
      </PopoverContent>
    </Popover>
  );
}
