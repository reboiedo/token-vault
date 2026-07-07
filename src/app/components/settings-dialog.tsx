/**
 * Design-system settings — port of the cloud settings dialog's DOMAIN
 * sections (web/src/components/settings-dialog.tsx): a section sidebar
 * on the left, scrollable panel on the right.
 *
 *   General      — Name, Description, Tailwind palette switch,
 *                  Export layout select.
 *   Fluid Scales — the viewport min/max + intermediate breakpoints
 *                  that drive every Utopia-style clamp().
 *
 * Cloud-only sections (Team, API keys, GitHub, History, Figma, Account)
 * have no local equivalent and are omitted.
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SystemDoc } from "@core/types";
import { useActions, useSystem } from "@/lib/store";
import { cn } from "@/lib/utils";

type Section = "general" | "fluid";

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: "general", label: "General" },
  { id: "fluid", label: "Fluid Scales" },
];

function GeneralSection({
  system,
  onSave,
}: {
  system: SystemDoc;
  onSave: (patch: Partial<SystemDoc>) => Promise<void>;
}) {
  const [name, setName] = useState(system.name);
  const [description, setDescription] = useState(system.description ?? "");
  useEffect(() => {
    setName(system.name);
    setDescription(system.description ?? "");
  }, [system.name, system.description]);

  const dirty =
    name !== system.name && name.trim() !== ""
      ? true
      : description !== (system.description ?? "");

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Description</Label>
        <Input
          value={description}
          placeholder="Optional description"
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      {dirty && (
        <Button
          size="sm"
          onClick={() =>
            void onSave({
              ...(name.trim() ? { name: name.trim() } : {}),
              description: description || undefined,
            })
          }
        >
          Save Changes
        </Button>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Tailwind Colors</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            Use the Tailwind CSS color palette in alias pickers, surface
            bases and anchors.
          </p>
          <Switch
            checked={system.useTailwindColors ?? false}
            onCheckedChange={(useTailwindColors) =>
              void onSave({ useTailwindColors })
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Tailwind → Figma</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            Materialize <code>{"{ $tw }"}</code> refs as a read-only
            <b> Tailwind</b> variable collection in Figma and alias-link your
            tokens to it, instead of baking them to raw values.
          </p>
          <Select
            value={system.tailwindFigmaBridge ?? "off"}
            onValueChange={(v) =>
              v &&
              void onSave({
                tailwindFigmaBridge: v as SystemDoc["tailwindFigmaBridge"],
              })
            }
          >
            <SelectTrigger className="h-8 w-52 text-xs">
              <SelectValue>
                {system.tailwindFigmaBridge === "used"
                  ? "Referenced only"
                  : system.tailwindFigmaBridge === "full"
                    ? "Full Tailwind theme"
                    : "Off (bake to raw)"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off" className="text-xs">
                Off (bake to raw)
              </SelectItem>
              <SelectItem value="used" className="text-xs">
                Referenced only (tree-shaken)
              </SelectItem>
              <SelectItem value="full" className="text-xs">
                Full Tailwind theme
              </SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Export Layout</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            How <code>token-vault build</code> splits the DTCG output.
          </p>
          <Select
            value={system.exportLayout ?? "single"}
            onValueChange={(v) =>
              v && void onSave({ exportLayout: v as SystemDoc["exportLayout"] })
            }
          >
            <SelectTrigger className="h-8 w-52 text-xs">
              <SelectValue>
                {(system.exportLayout ?? "single") === "single"
                  ? "Single file"
                  : "One file per collection"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="single" className="text-xs">
                Single file
              </SelectItem>
              <SelectItem value="per-collection" className="text-xs">
                One file per collection
              </SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Surface recipes</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            Export the surfaces rules as seed-driven relative colors
            (<code>color-mix()</code> / <code>oklch(from …)</code>). Consumers
            set <code>--surface</code> / <code>--ink</code> per scope and every
            level recolors. Baked per-surface tokens are still emitted.
          </p>
          <Select
            value={system.surfaceRecipes ?? "off"}
            onValueChange={(v) =>
              v &&
              void onSave({
                surfaceRecipes: v as SystemDoc["surfaceRecipes"],
              })
            }
          >
            <SelectTrigger className="h-8 w-52 text-xs">
              <SelectValue>
                {system.surfaceRecipes === "css"
                  ? "CSS layer"
                  : system.surfaceRecipes === "dtcg"
                    ? "DTCG tokens"
                    : system.surfaceRecipes === "both"
                      ? "CSS + DTCG"
                      : "Off (baked only)"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off" className="text-xs">
                Off (baked only)
              </SelectItem>
              <SelectItem value="css" className="text-xs">
                CSS layer (surfaces.css)
              </SelectItem>
              <SelectItem value="dtcg" className="text-xs">
                DTCG tokens (surface-recipe)
              </SelectItem>
              <SelectItem value="both" className="text-xs">
                CSS + DTCG
              </SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
    </div>
  );
}

function FluidSection({
  system,
  onSave,
}: {
  system: SystemDoc;
  onSave: (patch: Partial<SystemDoc>) => Promise<void>;
}) {
  const [minWidth, setMinWidth] = useState(system.fluid.viewport.minWidth);
  const [maxWidth, setMaxWidth] = useState(system.fluid.viewport.maxWidth);
  const [breakpoints, setBreakpoints] = useState<number[]>(
    system.fluid.breakpoints
  );
  const [newBp, setNewBp] = useState("");

  useEffect(() => {
    setMinWidth(system.fluid.viewport.minWidth);
    setMaxWidth(system.fluid.viewport.maxWidth);
    setBreakpoints(system.fluid.breakpoints);
  }, [system.fluid]);

  const dirty = useMemo(
    () =>
      minWidth !== system.fluid.viewport.minWidth ||
      maxWidth !== system.fluid.viewport.maxWidth ||
      JSON.stringify(breakpoints) !== JSON.stringify(system.fluid.breakpoints),
    [minWidth, maxWidth, breakpoints, system.fluid]
  );

  const addBreakpoint = () => {
    const bp = parseInt(newBp, 10);
    if (!Number.isFinite(bp)) return;
    if (bp <= minWidth || bp >= maxWidth) return;
    if (breakpoints.includes(bp)) return;
    setBreakpoints([...breakpoints, bp].sort((a, b) => a - b));
    setNewBp("");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Breakpoints</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Every fluid <code>clamp()</code> interpolates between the min and
            max viewport. Intermediate breakpoints drive the scale charts and
            per-breakpoint exports.
          </p>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label className="w-24 text-xs text-muted-foreground">Max</Label>
              <Input
                type="number"
                value={maxWidth}
                onChange={(e) => setMaxWidth(parseInt(e.target.value) || 0)}
                className="h-8 w-28"
              />
              <span className="text-xs text-muted-foreground">px</span>
            </div>
            {/* Intermediate breakpoints, descending like the cloud */}
            {[...breakpoints]
              .sort((a, b) => b - a)
              .map((bp) => (
                <div key={bp} className="flex items-center gap-2">
                  <span className="w-24" />
                  <span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs">
                    {bp}px
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                      onClick={() =>
                        setBreakpoints(breakpoints.filter((b) => b !== bp))
                      }
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                </div>
              ))}
            <div className="flex items-center gap-2">
              <span className="w-24" />
              <Input
                type="number"
                value={newBp}
                placeholder="810"
                onChange={(e) => setNewBp(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addBreakpoint()}
                className="h-8 w-28"
              />
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={addBreakpoint}
                title="Add intermediate breakpoint (must be between min and max)"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Label className="w-24 text-xs text-muted-foreground">Min</Label>
              <Input
                type="number"
                value={minWidth}
                onChange={(e) => setMinWidth(parseInt(e.target.value) || 0)}
                className="h-8 w-28"
              />
              <span className="text-xs text-muted-foreground">px</span>
            </div>
          </div>
          {dirty && (
            <Button
              size="sm"
              onClick={() =>
                void onSave({
                  fluid: {
                    viewport: { minWidth, maxWidth },
                    breakpoints: breakpoints.filter(
                      (b) => b > minWidth && b < maxWidth
                    ),
                  },
                })
              }
            >
              Save Fluid Settings
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const system = useSystem();
  const actions = useActions();
  const [section, setSection] = useState<Section>("general");

  if (!system) return null;
  const save = (patch: Partial<SystemDoc>) => actions.updateSystem(patch);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-h-[600px] flex-col sm:max-w-[900px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 gap-4">
          <aside className="w-44 shrink-0 space-y-0.5 border-r pr-3">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                className={cn(
                  "block w-full rounded px-2 py-1.5 text-left text-sm transition hover:bg-accent",
                  section === s.id && "bg-accent font-medium"
                )}
              >
                {s.label}
              </button>
            ))}
          </aside>
          <div className="min-w-0 flex-1 overflow-y-auto pr-1">
            {section === "general" && (
              <GeneralSection system={system} onSave={save} />
            )}
            {section === "fluid" && (
              <FluidSection system={system} onSave={save} />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
