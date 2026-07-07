"use client";

/**
 * Shared Tailwind default-theme *utility* pickers — the non-color
 * sibling of `tailwind-color-picker.tsx`. Lets the token editor lean on
 * Tailwind's font-weight / leading / tracking / text / spacing / radius /
 * … scales, writing a `{"$tw":"font-bold"}` reference.
 *
 *   - `TailwindUtilityCommandGroup`: CommandGroups (one per scale) to
 *     embed in an existing Command list.
 *   - `TailwindUtilityPopover`: self-contained trigger + searchable
 *     popover for pickers that ONLY choose a Tailwind utility.
 */

import * as React from "react";
import { Wind } from "lucide-react";
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
import type { TailwindThemeScale } from "@core/tailwind-theme";

/**
 * One CommandGroup per scale. Items carry `value={entry.ref}` so cmdk's
 * built-in filtering works against names like "font-bold" / "text-lg".
 */
export function TailwindUtilityCommandGroup({
  scales,
  onSelect,
}: {
  scales: TailwindThemeScale[];
  onSelect: (ref: string) => void;
}) {
  return (
    <>
      {scales.map((scale) => (
        <CommandGroup key={scale.namespace} heading={`Tailwind · ${scale.label}`}>
          {scale.entries.map((entry) => (
            <CommandItem
              key={entry.ref}
              value={entry.ref}
              onSelect={() => onSelect(entry.ref)}
              className="text-xs"
            >
              <span className="font-mono truncate">{entry.ref}</span>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                {entry.value}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      ))}
    </>
  );
}

/**
 * Self-contained Tailwind utility picker: `children` is the trigger; the
 * popover hosts a searchable list of the passed `scales`.
 */
export function TailwindUtilityPopover({
  scales,
  onSelect,
  children,
  align = "start",
}: {
  scales: TailwindThemeScale[];
  onSelect: (ref: string) => void;
  /** Trigger element — Base UI's `render` slot (single element). */
  children: React.ReactElement;
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = React.useState(false);
  if (scales.length === 0) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={children} />
      <PopoverContent className="p-0 w-72" align={align}>
        <Command>
          <CommandInput placeholder="Search Tailwind scale…" />
          <CommandList>
            <CommandEmpty>No utilities found.</CommandEmpty>
            <TailwindUtilityCommandGroup
              scales={scales}
              onSelect={(ref) => {
                onSelect(ref);
                setOpen(false);
              }}
            />
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** A small "Tailwind" trigger button used next to slot/value pickers. */
export function TailwindUtilityTrigger(
  props: React.ComponentProps<"button">
) {
  return (
    <button
      type="button"
      title="Pick a Tailwind scale value"
      {...props}
      className={
        "inline-flex h-7 w-7 items-center justify-center rounded text-cyan-600 transition hover:bg-accent dark:text-cyan-400 " +
        (props.className ?? "")
      }
    >
      <Wind className="h-3.5 w-3.5" />
    </button>
  );
}
