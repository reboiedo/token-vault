/**
 * Per-collection Tailwind v4 export config — port of the cloud's
 * tailwind-collection-config.tsx. Controls the `tailwind` extension the
 * DTCG export emits ($extensions.tailwind):
 *
 *   · enabled           — opt this collection into Tailwind output
 *   · utility "spacing" — spacing collections map onto the Tailwind
 *                         spacing utility scale
 *   · semantic.modeSelectors — themes collections map each mode to a
 *                         CSS selector (light → ":root", dark → ".dark")
 */

import { useEffect, useState } from "react";
import { Wind } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { CollectionDoc } from "@core/types";
import { getEffectiveKind } from "@/lib/collection-kind";
import { useActions } from "@/lib/store";

export function TailwindCollectionConfig({
  collection,
}: {
  collection: CollectionDoc;
}) {
  const actions = useActions();
  const kind = getEffectiveKind(collection);
  const isSpacing = kind === "spacing";
  const isThemes = kind === "themes" || collection.modes.length > 1;

  const current = collection.tailwind;
  const [enabled, setEnabled] = useState(current?.enabled ?? false);
  const [selectors, setSelectors] = useState<Record<string, string>>(
    current?.semantic?.modeSelectors ?? {}
  );
  useEffect(() => {
    setEnabled(current?.enabled ?? false);
    setSelectors(current?.semantic?.modeSelectors ?? {});
  }, [current]);

  // Only relevant for spacing and multi-mode collections, like the cloud.
  if (!isSpacing && !isThemes) return null;

  const persist = (nextEnabled: boolean, nextSelectors: Record<string, string>) => {
    if (!nextEnabled) {
      void actions.updateCollectionTailwind({
        collection: collection.name,
        tailwind: { enabled: false },
      });
      return;
    }
    void actions.updateCollectionTailwind({
      collection: collection.name,
      tailwind: {
        enabled: true,
        ...(isSpacing ? { utility: "spacing" as const } : {}),
        ...(isThemes
          ? {
              semantic: {
                modeSelectors: Object.fromEntries(
                  collection.modes.map((m) => [
                    m,
                    nextSelectors[m] ??
                      (m === "light" ? ":root" : `.theme-${m}`),
                  ])
                ),
              },
            }
          : {}),
      },
    });
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant={current?.enabled ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs"
            title="Tailwind v4 export config for this collection"
          >
            <Wind className="h-3.5 w-3.5" /> Tailwind
          </Button>
        }
      />
      <PopoverContent className="w-72 space-y-3 p-3" align="start">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-xs">Tailwind export</Label>
            <p className="text-[10px] text-muted-foreground">
              Emit <code>$extensions.tailwind</code> for this collection.
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(next) => {
              setEnabled(next);
              persist(next, selectors);
            }}
          />
        </div>

        {enabled && isSpacing && (
          <p className="rounded border bg-muted/30 px-2 py-1.5 text-[10px] text-muted-foreground">
            Mapped to the Tailwind <code>spacing</code> utility scale.
          </p>
        )}

        {enabled && isThemes && (
          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground">
              Mode selectors
            </Label>
            {collection.modes.map((mode) => (
              <div key={mode} className="flex items-center gap-2">
                <span className="w-16 shrink-0 font-mono text-[10px] text-muted-foreground">
                  {mode}
                </span>
                <Input
                  value={selectors[mode] ?? (mode === "light" ? ":root" : `.theme-${mode}`)}
                  onChange={(e) =>
                    setSelectors({ ...selectors, [mode]: e.target.value })
                  }
                  onBlur={() => persist(true, selectors)}
                  onKeyDown={(e) => e.key === "Enter" && persist(true, selectors)}
                  className="h-7 flex-1 font-mono text-xs"
                  placeholder={mode === "light" ? ":root" : `.theme-${mode}`}
                />
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
