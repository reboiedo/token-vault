/**
 * Shell dialogs, ported from the cloud's central page:
 *   - CreateCollectionDialog: name + preset (single mode / multi-mode
 *     light+dark).
 *   - AddGeneratorDialog: type select (color/spacing/typography +
 *     Surfaces, gated to multi-mode collections), group prefix with
 *     `prefix.{step}` preview; surfaces seeds and navigates.
 *   - JsonPreviewDialog: tabs for tokens.json / $metadata.json with a
 *     Copy button, honoring the system's exportLayout.
 */

import { useMemo, useState } from "react";
import { Check, Copy, Hash, Palette, Ruler, Sparkles, SwatchBook, Type } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  generateDtcgExport,
  serializeMetadata,
  serializeTokens,
} from "@core/dtcg-export";
import type { CollectionDoc, GeneratorDef } from "@core/types";
import { useActions, useSnapshot } from "@/lib/store";

// ============================================================================
// CREATE COLLECTION
// ============================================================================

export function CreateCollectionDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (name: string) => void;
}) {
  const actions = useActions();
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<"default" | "themes">("default");
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await actions.createCollection({
        name: trimmed,
        modes: preset === "themes" ? ["light", "dark"] : ["default"],
      });
      onCreated(trimmed);
      setName("");
      setError(null);
      onOpenChange(false);
    } catch (err) {
      setError(String((err as Error).message));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Create Collection</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input
              autoFocus
              value={name}
              placeholder="Core, Semantic, Brand…"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void create()}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Preset</Label>
            <Select
              value={preset}
              onValueChange={(v) => v && setPreset(v as typeof preset)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue>
                  {preset === "default" ? "Default (single mode)" : "Multi-mode (light/dark)"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default" className="text-xs">
                  <Hash className="h-3 w-3" /> Default (single mode)
                </SelectItem>
                <SelectItem value="themes" className="text-xs">
                  <SwatchBook className="h-3 w-3" /> Multi-mode (light/dark)
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {preset === "default"
                ? "A generic container with a single mode — add generators later."
                : "Starts with light and dark themes; ideal for semantic colors and the surfaces helper."}
            </p>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!name.trim()} onClick={() => void create()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// ADD GENERATOR
// ============================================================================

type GeneratorChoice = "color" | "spacing" | "typography" | "surfaces";

const GENERATOR_META: Record<
  GeneratorChoice,
  { label: string; icon: typeof Palette; defaultPrefix: string; hint: string }
> = {
  color: {
    label: "Color Scale",
    icon: Palette,
    defaultPrefix: "color",
    hint: "OKLCH families with per-channel curves.",
  },
  spacing: {
    label: "Spacing Scale",
    icon: Ruler,
    defaultPrefix: "space",
    hint: "Fluid clamp() spacing with pairs.",
  },
  typography: {
    label: "Typography Scale",
    icon: Type,
    defaultPrefix: "type",
    hint: "Fluid clamp() type sizes.",
  },
  surfaces: {
    label: "Surfaces helper",
    icon: Sparkles,
    defaultPrefix: "",
    hint: "Seeds a neutral surface with fg / fg-muted / border levels derived by APCA contrast.",
  },
};

function defaultGeneratorConfig(
  type: Exclude<GeneratorChoice, "surfaces">
): GeneratorDef["config"] {
  switch (type) {
    case "color":
      return {
        type,
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
      };
    case "spacing":
      return {
        type,
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
      };
    case "typography":
      return {
        type,
        typographyConfig: {
          prefix: "",
          unit: "rem",
          steps: [
            { minPx: 16, maxPx: 18 },
            { minPx: 20, maxPx: 24 },
            { minPx: 24, maxPx: 32 },
          ],
        },
      };
  }
}

export function AddGeneratorDialog({
  open,
  onOpenChange,
  collection,
  onSurfacesAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collection: CollectionDoc;
  onSurfacesAdded: () => void;
}) {
  const actions = useActions();
  const [choice, setChoice] = useState<GeneratorChoice>("color");
  const [prefix, setPrefix] = useState(GENERATOR_META.color.defaultPrefix);

  const surfacesAllowed =
    collection.modes.length > 1 ||
    (collection.modes.includes("light") && collection.modes.includes("dark"));
  const meta = GENERATOR_META[choice];

  const add = async () => {
    if (choice === "surfaces") {
      const fg = (lc: number) => ({
        kind: "fg" as const,
        onLight: { target: { kind: "apca" as const, lc }, anchor: { kind: "auto" as const } },
        onDark: { target: { kind: "apca" as const, lc }, anchor: { kind: "auto" as const } },
      });
      const uid = () => Math.random().toString(36).slice(2, 10);
      const base: Record<string, { kind: "raw"; value: string }> = {};
      const [first, second] = collection.modes;
      if (first) base[first] = { kind: "raw", value: "#ffffff" };
      if (second) base[second] = { kind: "raw", value: "#0a0a0a" };
      await actions.updateSurfacesConfig({
        collection: collection.name,
        config: {
          contrastThreshold: 0.6,
          surfaces: [
            { id: uid(), name: "bg", materializeBase: true, bareLevels: true, baseByMode: base },
          ],
          levels: [
            { id: uid(), name: "fg", rule: fg(90) },
            { id: uid(), name: "fg-muted", rule: fg(60) },
            { id: uid(), name: "border", display: "separator", rule: fg(18) },
          ],
        },
      });
      onOpenChange(false);
      onSurfacesAdded();
      return;
    }
    await actions.addGenerator({
      collection: collection.name,
      generator: {
        id: `g-${Math.random().toString(36).slice(2, 8)}`,
        type: choice,
        groupPrefix: prefix.trim(),
        config: defaultGeneratorConfig(choice),
      },
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Generator</DialogTitle>
          <DialogDescription>
            Generators inject recomputed tokens into this collection.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Type</Label>
            <Select
              value={choice}
              onValueChange={(v) => {
                if (!v) return;
                setChoice(v as GeneratorChoice);
                setPrefix(GENERATOR_META[v as GeneratorChoice].defaultPrefix);
              }}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue>{meta.label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(GENERATOR_META) as GeneratorChoice[])
                  .filter((k) => k !== "surfaces" || surfacesAllowed)
                  .map((k) => {
                    const Icon = GENERATOR_META[k].icon;
                    return (
                      <SelectItem key={k} value={k} className="text-xs">
                        <Icon className="h-3 w-3" /> {GENERATOR_META[k].label}
                      </SelectItem>
                    );
                  })}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{meta.hint}</p>
          </div>
          {choice !== "surfaces" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Group Prefix</Label>
              <Input
                value={prefix}
                placeholder="(root)"
                onChange={(e) => setPrefix(e.target.value)}
                className="h-8 font-mono text-xs"
              />
              <p className="font-mono text-xs text-muted-foreground">
                {prefix.trim() ? `${prefix.trim()}.{step}` : "{step}"}
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void add()}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// JSON PREVIEW
// ============================================================================

export function JsonPreviewDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const snapshot = useSnapshot();
  const [copied, setCopied] = useState<string | null>(null);

  const result = useMemo(() => {
    if (!snapshot) return null;
    try {
      const layout = snapshot.system.exportLayout ?? "single";
      const r = generateDtcgExport(
        snapshot.system,
        snapshot.collections,
        "default",
        layout
      );
      const files: Array<{ name: string; content: string }> = [];
      if (layout === "per-collection" && r.tokenFiles) {
        for (const [name, tokens] of Object.entries(r.tokenFiles)) {
          files.push({
            name: `${name}.json`,
            content: serializeTokens(tokens as Record<string, unknown>),
          });
        }
      } else {
        files.push({ name: "tokens.json", content: serializeTokens(r.tokens) });
      }
      files.push({ name: "$metadata.json", content: serializeMetadata(r.metadata) });
      return files;
    } catch {
      return null;
    }
  }, [snapshot]);

  if (!result) return null;

  const copy = (file: { name: string; content: string }) => {
    void navigator.clipboard.writeText(file.content);
    setCopied(file.name);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-h-[700px] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Generated Token Files</DialogTitle>
          <DialogDescription>
            The DTCG output <code>token-vault build</code> writes to{" "}
            <code>dist/</code>.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue={result[0].name} className="flex min-h-0 flex-1 flex-col">
          <TabsList>
            {result.map((f) => (
              <TabsTrigger key={f.name} value={f.name} className="font-mono text-xs">
                {f.name}
              </TabsTrigger>
            ))}
          </TabsList>
          {result.map((f) => (
            <TabsContent key={f.name} value={f.name} className="min-h-0 flex-1">
              <div className="relative h-full">
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute right-2 top-2 z-10 h-7 text-xs"
                  onClick={() => copy(f)}
                >
                  {copied === f.name ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  Copy
                </Button>
                <pre className="h-full overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs">
                  {f.content}
                </pre>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
