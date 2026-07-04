/**
 * Color scale editor — faithful port of the cloud product's editor:
 * per-family Primer-Prism layout with the interactive CombinedCurveGraph
 * (drag per-step overrides, drag curve handles, lock shades to a hex,
 * per-channel offset) plus a side panel per channel (start/end, curve
 * preset with hover preview, sync-across-families lock).
 *
 * Cloud counterpart: web/src/components/color-scale-editor.tsx. Only
 * the persistence differs: `initialConfig` + `onSave(config)`.
 */

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Lock,
  Plus,
  RotateCcw,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CombinedCurveGraph } from "./combined-curve-graph";
import {
  CURVE_FAMILIES,
  DEFAULT_CUSTOM_BEZIER,
  generateFamilyColors,
  type ChannelConfig,
  type ColorFamily,
  type ColorScaleConfig,
  type CurveType,
  type SyncedChannels,
} from "@core/color-utils";

type ChannelKey = "lightness" | "chroma" | "hue";

const CHANNEL_META: Record<ChannelKey, { min: number; max: number; step: number; label: string; shortLabel: string }> = {
  lightness: { min: 0, max: 1, step: 0.01, label: "Lightness", shortLabel: "L" },
  chroma: { min: 0, max: 0.4, step: 0.01, label: "Chroma", shortLabel: "C" },
  hue: { min: 0, max: 360, step: 1, label: "Hue", shortLabel: "H" },
};

const CURVE_FAMILY_LABELS: Record<string, string> = {
  basic: "Basic",
  sine: "Sine",
  quadratic: "Quadratic",
  cubic: "Cubic",
  quartic: "Quartic",
  quintic: "Quintic",
  exponential: "Exponential",
  circular: "Circular",
};

function curveLabel(curve: CurveType): string {
  if (curve === "linear") return "Linear";
  if (curve === "custom") return "Custom";
  return curve
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ============================================================================
// CHANNEL SIDE PANEL
// ============================================================================

function ChannelControlPanel({
  channelKey,
  channel,
  isSynced,
  isFirstFamily,
  firstFamilyName,
  onChange,
  onClearAllOverrides,
  onToggleSync,
  onPreviewCurve,
}: {
  channelKey: ChannelKey;
  channel: ChannelConfig;
  isSynced?: boolean;
  isFirstFamily: boolean;
  firstFamilyName: string;
  onChange: (
    field: "start" | "end" | "curve" | "customBezier",
    value: number | CurveType | [number, number, number, number]
  ) => void;
  onClearAllOverrides: () => void;
  onToggleSync: () => void;
  onPreviewCurve: (curve: CurveType | null) => void;
}) {
  const meta = CHANNEL_META[channelKey];
  const hasOverrides =
    channel.overrides && Object.keys(channel.overrides).length > 0;
  const isDisabled = !!isSynced && !isFirstFamily;

  return (
    <div
      className={`space-y-2 rounded-lg border bg-background p-3 ${isDisabled ? "opacity-60" : ""}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{meta.label}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={onToggleSync}
            title={
              isSynced
                ? `Unlock ${meta.label.toLowerCase()} (use per-family values)`
                : `Lock ${meta.label.toLowerCase()} (sync across all families)`
            }
          >
            {isSynced ? (
              <Lock className="h-3 w-3 text-primary" />
            ) : (
              <Unlock className="h-3 w-3 text-muted-foreground" />
            )}
          </Button>
          {isSynced && !isFirstFamily && (
            <span className="text-[10px] text-muted-foreground">
              {firstFamilyName}
            </span>
          )}
        </div>
        {hasOverrides && !isDisabled && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px]"
            onClick={onClearAllOverrides}
          >
            <RotateCcw className="mr-1 h-2.5 w-2.5" />
            Reset
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(["start", "end"] as const).map((field) => (
          <div key={field}>
            <Label className="text-[10px] text-muted-foreground capitalize">
              {field}
            </Label>
            <Input
              type="number"
              min={meta.min}
              max={meta.max}
              step={meta.step}
              value={channel[field]}
              onChange={(e) => onChange(field, parseFloat(e.target.value) || 0)}
              className="h-7 font-mono text-xs"
              disabled={isDisabled}
            />
          </div>
        ))}
      </div>

      <div>
        <Label className="text-[10px] text-muted-foreground">Curve</Label>
        <Select
          value={channel.curve}
          onValueChange={(value) => {
            onChange("curve", value as CurveType);
            if (value === "custom" && !channel.customBezier) {
              onChange("customBezier", DEFAULT_CUSTOM_BEZIER);
            }
            onPreviewCurve(null);
          }}
          onOpenChange={(open) => {
            if (!open) onPreviewCurve(null);
          }}
          disabled={isDisabled}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="linear" className="text-xs">Linear</SelectItem>
            <SelectItem value="custom" className="text-xs">Custom</SelectItem>
            {Object.entries(CURVE_FAMILIES).map(([familyName, curves]) => (
              <div key={familyName}>
                <div className="mb-1 border-b border-border/50 bg-muted/30 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground/50">
                  {CURVE_FAMILY_LABELS[familyName] ?? familyName}
                </div>
                {curves
                  .filter((c) => c !== "linear" && c !== "custom")
                  .map((curve) => (
                    <SelectItem
                      key={curve}
                      value={curve}
                      className="text-xs"
                      onMouseEnter={() => onPreviewCurve(curve)}
                      onMouseLeave={() => onPreviewCurve(null)}
                    >
                      {curveLabel(curve)}
                    </SelectItem>
                  ))}
              </div>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ============================================================================
// FAMILY EDITOR — graph + side panels
// ============================================================================

function FamilyEditor({
  family,
  steps,
  syncedChannels,
  firstFamily,
  isFirstFamily,
  canRemove,
  onUpdateFamily,
  onUpdateChannel,
  onSetOverride,
  onCustomCurve,
  onClearOverride,
  onClearAllOverrides,
  onOffsetChannel,
  onLockShadeToColor,
  onUnlockShade,
  onToggleSync,
  onRemove,
}: {
  family: ColorFamily;
  steps: string[];
  syncedChannels?: SyncedChannels;
  firstFamily: ColorFamily;
  isFirstFamily: boolean;
  canRemove: boolean;
  onUpdateFamily: (updates: Partial<ColorFamily>) => void;
  onUpdateChannel: (
    channel: ChannelKey,
    field: "start" | "end" | "curve" | "customBezier",
    value: number | CurveType | [number, number, number, number]
  ) => void;
  onSetOverride: (channel: ChannelKey, step: string, value: number) => void;
  onCustomCurve: (
    channel: ChannelKey,
    bezier: [number, number, number, number]
  ) => void;
  onClearOverride: (channel: ChannelKey, step: string) => void;
  onClearAllOverrides: (channel: ChannelKey) => void;
  onOffsetChannel: (channel: ChannelKey, delta: number) => void;
  onLockShadeToColor: (
    step: string,
    oklch: { l: number; c: number; h: number }
  ) => void;
  onUnlockShade: (step: string) => void;
  onToggleSync: (channel: ChannelKey) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [previewCurves, setPreviewCurves] = useState<{
    lightness?: CurveType | null;
    chroma?: CurveType | null;
    hue?: CurveType | null;
  }>({});

  // Synced channels read from the first family (the source of truth).
  const channelOverrides = useMemo(
    () => ({
      lightness: syncedChannels?.lightness ? firstFamily.lightness : undefined,
      chroma: syncedChannels?.chroma ? firstFamily.chroma : undefined,
      hue: syncedChannels?.hue ? firstFamily.hue : undefined,
    }),
    [syncedChannels, firstFamily]
  );

  const swatches = useMemo(() => {
    try {
      return generateFamilyColors(family, steps, channelOverrides);
    } catch {
      return [];
    }
  }, [family, steps, channelOverrides]);

  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      className="overflow-hidden rounded-lg border"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 transition hover:bg-accent/50">
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )}
        <Input
          value={family.name}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onUpdateFamily({ name: e.target.value })}
          className="h-7 w-32 font-mono text-xs"
        />
        <div className="flex h-6 flex-1 overflow-hidden rounded">
          {swatches.map((s) => (
            <div
              key={s.step}
              className="flex-1"
              style={{ background: s.hex }}
              title={`${family.name}.${s.step}: ${s.hex}`}
            />
          ))}
        </div>
        {canRemove && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="border-t">
          <div className="flex">
            <div className="min-w-0 flex-1">
              <CombinedCurveGraph
                family={family}
                steps={steps}
                height={450}
                channelOverrides={channelOverrides}
                previewCurves={previewCurves}
                onOverride={onSetOverride}
                onStartEndChange={(channel, field, value) =>
                  onUpdateChannel(channel, field, value)
                }
                onCustomCurve={onCustomCurve}
                onClearOverride={onClearOverride}
                onOffsetChannel={onOffsetChannel}
                onLockShadeToColor={onLockShadeToColor}
                onUnlockShade={onUnlockShade}
              />
            </div>
            <div className="w-64 space-y-3 border-l bg-muted/20 p-3">
              <Label className="text-sm font-medium">Scale</Label>
              {(["lightness", "chroma", "hue"] as const).map((channelKey) => (
                <ChannelControlPanel
                  key={channelKey}
                  channelKey={channelKey}
                  channel={
                    syncedChannels?.[channelKey]
                      ? firstFamily[channelKey]
                      : family[channelKey]
                  }
                  isSynced={syncedChannels?.[channelKey]}
                  isFirstFamily={isFirstFamily}
                  firstFamilyName={firstFamily.name}
                  onChange={(field, value) =>
                    onUpdateChannel(channelKey, field, value)
                  }
                  onClearAllOverrides={() => onClearAllOverrides(channelKey)}
                  onToggleSync={() => onToggleSync(channelKey)}
                  onPreviewCurve={(curve) =>
                    setPreviewCurves((prev) => ({
                      ...prev,
                      [channelKey]: curve,
                    }))
                  }
                />
              ))}
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ============================================================================
// MAIN EDITOR
// ============================================================================

export function ColorScaleEditor({
  initialConfig,
  onSave,
}: {
  initialConfig: ColorScaleConfig;
  onSave: (config: ColorScaleConfig) => void | Promise<void>;
}) {
  const [config, setConfig] = useState(initialConfig);
  const dirty = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(initialConfig),
    [config, initialConfig]
  );

  const patchFamily = (i: number, next: Partial<ColorFamily>) =>
    setConfig((prev) => ({
      ...prev,
      families: prev.families.map((f, j) => (j === i ? { ...f, ...next } : f)),
    }));

  const patchChannel = (
    i: number,
    channel: ChannelKey,
    patch: Partial<ChannelConfig>
  ) =>
    setConfig((prev) => ({
      ...prev,
      families: prev.families.map((f, j) =>
        j === i ? { ...f, [channel]: { ...f[channel], ...patch } } : f
      ),
    }));

  return (
    <div className="space-y-4">
      {/* Steps + save bar */}
      <div className="flex items-center gap-2">
        <Label className="text-[11px] text-muted-foreground">steps</Label>
        <Input
          value={config.steps.join(", ")}
          onChange={(e) =>
            setConfig({
              ...config,
              steps: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          className="h-7 w-96 font-mono text-xs"
        />
        {dirty && (
          <>
            <Button size="sm" className="h-7" onClick={() => void onSave(config)}>
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => setConfig(initialConfig)}
            >
              <X className="h-3 w-3" /> Discard
            </Button>
          </>
        )}
      </div>

      {config.families.map((family, i) => (
        <FamilyEditor
          key={i}
          family={family}
          steps={config.steps}
          syncedChannels={config.syncedChannels}
          firstFamily={config.families[0]}
          isFirstFamily={i === 0}
          canRemove={config.families.length > 1}
          onUpdateFamily={(updates) => patchFamily(i, updates)}
          onUpdateChannel={(channel, field, value) =>
            patchChannel(i, channel, { [field]: value })
          }
          onSetOverride={(channel, step, value) =>
            setConfig((prev) => ({
              ...prev,
              families: prev.families.map((f, j) =>
                j === i
                  ? {
                      ...f,
                      [channel]: {
                        ...f[channel],
                        overrides: { ...f[channel].overrides, [step]: value },
                      },
                    }
                  : f
              ),
            }))
          }
          onCustomCurve={(channel, bezier) =>
            patchChannel(i, channel, {
              curve: "custom" as CurveType,
              customBezier: bezier,
            })
          }
          onClearOverride={(channel, step) =>
            setConfig((prev) => ({
              ...prev,
              families: prev.families.map((f, j) => {
                if (j !== i) return f;
                const { [step]: _, ...rest } = f[channel].overrides ?? {};
                return {
                  ...f,
                  [channel]: {
                    ...f[channel],
                    overrides: Object.keys(rest).length ? rest : undefined,
                  },
                };
              }),
            }))
          }
          onClearAllOverrides={(channel) =>
            patchChannel(i, channel, { overrides: undefined })
          }
          onOffsetChannel={(channel, delta) =>
            setConfig((prev) => ({
              ...prev,
              families: prev.families.map((f, j) => {
                if (j !== i) return f;
                const meta = CHANNEL_META[channel];
                const clamp = (n: number) =>
                  Math.max(meta.min, Math.min(meta.max, n));
                const c = f[channel];
                let overrides: Record<string, number> | undefined;
                if (c.overrides) {
                  overrides = {};
                  for (const [step, v] of Object.entries(c.overrides)) {
                    overrides[step] = clamp(
                      (typeof v === "number" ? v : v.value) + delta
                    );
                  }
                }
                return {
                  ...f,
                  [channel]: {
                    ...c,
                    start: clamp(c.start + delta),
                    end: clamp(c.end + delta),
                    overrides,
                  },
                };
              }),
            }))
          }
          onLockShadeToColor={(step, oklch) =>
            setConfig((prev) => ({
              ...prev,
              families: prev.families.map((f, j) =>
                j === i
                  ? {
                      ...f,
                      lightness: {
                        ...f.lightness,
                        overrides: { ...f.lightness.overrides, [step]: oklch.l },
                      },
                      chroma: {
                        ...f.chroma,
                        overrides: { ...f.chroma.overrides, [step]: oklch.c },
                      },
                      hue: {
                        ...f.hue,
                        overrides: { ...f.hue.overrides, [step]: oklch.h },
                      },
                    }
                  : f
              ),
            }))
          }
          onUnlockShade={(step) =>
            setConfig((prev) => ({
              ...prev,
              families: prev.families.map((f, j) => {
                if (j !== i) return f;
                const strip = (c: ChannelConfig) => {
                  const { [step]: _, ...rest } = c.overrides ?? {};
                  return {
                    ...c,
                    overrides: Object.keys(rest).length ? rest : undefined,
                  };
                };
                return {
                  ...f,
                  lightness: strip(f.lightness),
                  chroma: strip(f.chroma),
                  hue: strip(f.hue),
                };
              }),
            }))
          }
          onToggleSync={(channel) =>
            setConfig((prev) => ({
              ...prev,
              syncedChannels: {
                ...prev.syncedChannels,
                [channel]: !prev.syncedChannels?.[channel],
              },
            }))
          }
          onRemove={() =>
            setConfig((prev) => ({
              ...prev,
              families: prev.families.filter((_, j) => j !== i),
            }))
          }
        />
      ))}

      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs text-muted-foreground"
        onClick={() =>
          setConfig((prev) => ({
            ...prev,
            families: [
              ...prev.families,
              {
                name: `family-${prev.families.length + 1}`,
                lightness: { start: 0.97, end: 0.25, curve: "ease-out" },
                chroma: { start: 0.02, end: 0.09, curve: "ease-in-out" },
                hue: { start: 250, end: 250, curve: "linear" },
              },
            ],
          }))
        }
      >
        <Plus className="h-3 w-3" /> Add family
      </Button>
    </div>
  );
}
