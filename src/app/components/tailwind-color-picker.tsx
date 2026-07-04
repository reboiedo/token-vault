"use client";

/**
 * Shared Tailwind-palette pickers.
 *
 * The token editor (`value-cell.tsx`), the derivation editor, and the
 * surfaces editor all offer "pick a Tailwind color" affordances gated
 * on the design system's `useTailwindColors` flag. This module holds
 * the shared UI so the family-grouped list looks and filters the same
 * everywhere:
 *
 *   - `TailwindColorCommandGroup`: a CommandGroup to embed in an
 *     existing Command list (e.g. alongside token groups).
 *   - `TailwindColorPopover`: a self-contained trigger + popover +
 *     command palette for pickers that ONLY choose a Tailwind color.
 */

import * as React from "react";
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
  getTailwindColorsByFamily,
  TAILWIND_FAMILY_NAMES,
} from "@core/tailwind-colors";

/**
 * Family-grouped Tailwind color items for an existing Command list.
 * Items carry `value={color.name}` so cmdk's built-in filtering works
 * against names like "slate-500".
 */
export function TailwindColorCommandGroup({
  heading = "Tailwind CSS",
  onSelect,
}: {
  heading?: string;
  onSelect: (color: string) => void;
}) {
  const byFamily = React.useMemo(() => getTailwindColorsByFamily(), []);
  return (
    <CommandGroup heading={heading}>
      {Object.entries(byFamily).map(([family, colors]) => (
        <React.Fragment key={family}>
          <div className="text-[10px] font-medium text-muted-foreground px-2 py-0.5">
            {TAILWIND_FAMILY_NAMES[family] || family}
          </div>
          {colors.map((color) => (
            <CommandItem
              key={color.name}
              value={color.name}
              onSelect={() => onSelect(color.name)}
              className="text-xs"
            >
              <div
                className="h-3 w-3 rounded border shrink-0"
                style={{ backgroundColor: color.hex }}
              />
              <span className="ml-1 font-mono truncate">{color.name}</span>
            </CommandItem>
          ))}
        </React.Fragment>
      ))}
    </CommandGroup>
  );
}

/**
 * Self-contained Tailwind color picker: `children` is the trigger; the
 * popover hosts a searchable, family-grouped palette.
 */
export function TailwindColorPopover({
  onSelect,
  children,
  align = "start",
}: {
  onSelect: (color: string) => void;
  /** Trigger element — Base UI's `render` slot (single element). */
  children: React.ReactElement;
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={children} />
      <PopoverContent className="p-0 w-72" align={align}>
        <Command>
          <CommandInput placeholder="Search Tailwind colors…" />
          <CommandList>
            <CommandEmpty>No colors found.</CommandEmpty>
            <TailwindColorCommandGroup
              onSelect={(color) => {
                onSelect(color);
                setOpen(false);
              }}
            />
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
