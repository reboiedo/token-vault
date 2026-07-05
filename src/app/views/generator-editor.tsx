/**
 * GeneratorEditorView — list a collection's generators and edit each
 * one's config. Saving recomputes the generated tokens server-side and
 * the new snapshot flows back through the store.
 */

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ColorScaleEditor } from "@/components/color-scale-editor";
import { SpacingScaleEditor } from "@/components/spacing-scale-editor";
import { TypographyScaleEditor } from "@/components/typography-scale-editor";
import type { CollectionDoc, GeneratorDef } from "@core/types";
import { useActions, useSystem } from "@/lib/store";
import { cn } from "@/lib/utils";

function defaultGenerator(type: GeneratorDef["type"]): GeneratorDef {
  const id = `g-${Math.random().toString(36).slice(2, 8)}`;
  switch (type) {
    case "color":
      return {
        id,
        type,
        groupPrefix: "color",
        config: {
          type: "color",
          colorScaleConfig: {
            steps: ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"],
            families: [
              {
                name: "neutral",
                lightness: { start: 0.98, end: 0.2, curve: "ease-out" },
                chroma: { start: 0.005, end: 0.02, curve: "linear" },
                hue: { start: 260, end: 260, curve: "linear" },
              },
            ],
          },
        },
      };
    case "spacing":
      return {
        id,
        type,
        groupPrefix: "space",
        config: {
          type: "spacing",
          spacingConfig: {
            baseMin: 16,
            baseMax: 20,
            unit: "rem",
            prefix: "space",
            includePairs: false,
            customPairs: [],
            steps: [
              { name: "s", multiplier: 1 },
              { name: "m", multiplier: 1.5 },
              { name: "l", multiplier: 2 },
            ],
          },
        },
      };
    case "typography":
      return {
        id,
        type,
        groupPrefix: "type",
        config: {
          type: "typography",
          typographyConfig: {
            prefix: "",
            unit: "rem",
            steps: [
              { minPx: 16, maxPx: 18 },
              { minPx: 20, maxPx: 24 },
              { minPx: 24, maxPx: 32 },
            ],
          },
        },
      };
  }
}

export function GeneratorEditorView({
  collection,
  onlyGeneratorId,
}: {
  collection: CollectionDoc;
  /** Dedicated-route mode: pin one generator and hide the switcher. */
  onlyGeneratorId?: string;
}) {
  const actions = useActions();
  const system = useSystem();
  const generators = collection.generators ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(
    onlyGeneratorId ?? generators[0]?.id ?? null
  );
  const selected =
    generators.find((g) => g.id === (onlyGeneratorId ?? selectedId)) ??
    (onlyGeneratorId ? null : generators[0] ?? null);
  const viewport = system?.fluid.viewport ?? { minWidth: 360, maxWidth: 1240 };

  const save = (generator: GeneratorDef, config: GeneratorDef["config"]) =>
    actions.updateGeneratorConfig({
      collection: collection.name,
      generatorId: generator.id,
      config,
    });

  return (
    <div className="space-y-4">
      <div className={onlyGeneratorId ? "hidden" : "flex flex-wrap items-center gap-2"}>
        {generators.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setSelectedId(g.id)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-mono transition hover:bg-accent",
              selected?.id === g.id && "bg-accent font-medium"
            )}
          >
            {g.type}
            <span className="ml-1.5 text-muted-foreground">
              {g.groupPrefix || "(root)"}
            </span>
          </button>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-1 rounded-md border border-dashed px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-accent">
            <Plus className="h-3 w-3" /> Add generator
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {(["color", "spacing", "typography"] as const).map((t) => (
              <DropdownMenuItem
                key={t}
                className="text-xs"
                onClick={() => {
                  const generator = defaultGenerator(t);
                  void actions
                    .addGenerator({ collection: collection.name, generator })
                    .then(() => setSelectedId(generator.id));
                }}
              >
                {t}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {selected && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 text-xs text-muted-foreground"
            onClick={() => {
              if (
                confirm(
                  `Remove the ${selected.type} generator "${selected.groupPrefix}" and its generated tokens?`
                )
              ) {
                void actions.removeGenerator({
                  collection: collection.name,
                  generatorId: selected.id,
                });
              }
            }}
          >
            <Trash2 className="h-3 w-3" /> Remove
          </Button>
        )}
      </div>

      {!selected && (
        <p className="text-sm text-muted-foreground">
          No generators in this collection yet.
        </p>
      )}

      {selected?.config.type === "color" && (
        <ColorScaleEditor
          key={selected.id}
          initialConfig={selected.config.colorScaleConfig}
          onSave={(colorScaleConfig) =>
            save(selected, { type: "color", colorScaleConfig })
          }
        />
      )}
      {selected?.config.type === "spacing" && (
        <SpacingScaleEditor
          key={selected.id}
          initialConfig={selected.config.spacingConfig}
          viewport={viewport}
          onSave={(spacingConfig) =>
            save(selected, { type: "spacing", spacingConfig })
          }
        />
      )}
      {selected?.config.type === "typography" && (
        <TypographyScaleEditor
          key={selected.id}
          initialConfig={selected.config.typographyConfig}
          viewport={viewport}
          breakpoints={system?.fluid.breakpoints ?? []}
          onSave={(typographyConfig) =>
            save(selected, { type: "typography", typographyConfig })
          }
        />
      )}
    </div>
  );
}
