/**
 * Lean scale editors — color / spacing / typography generator configs.
 *
 * These are functional ports of the cloud product's scale editors:
 * same config shapes, same pure preview functions (`generateColorScale`,
 * `generateSpacingScale`, `generateTypeScale`), pared down to number
 * inputs + curve selects. The bezier drag canvas and recharts curve
 * graphs from the original are visual upgrades to layer back on later.
 *
 * Contract: `initialConfig` seeds local state; `onSave(config)`
 * persists (wired to actions.updateGeneratorConfig by the view).
 */

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  generateSpacingScale,
  generateTypeScale,
  type SpacingScaleConfig,
  type TypeScaleConfig,
  type ViewportConfig,
} from "@core/fluid-utils";

function Num({
  label,
  value,
  step = 0.01,
  onChange,
  w = "w-20",
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (v: number) => void;
  w?: string;
}) {
  return (
    <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
      {label}
      <Input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`h-7 text-xs ${w}`}
      />
    </label>
  );
}

function SaveBar({
  dirty,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  if (!dirty) return null;
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" className="h-7" onClick={onSave}>
        Save
      </Button>
      <Button size="sm" variant="ghost" className="h-7" onClick={onDiscard}>
        Discard
      </Button>
    </div>
  );
}

// ============================================================================
// SPACING SCALE
// ============================================================================

export function SpacingScaleEditor({
  initialConfig,
  viewport,
  onSave,
}: {
  initialConfig: SpacingScaleConfig;
  viewport: ViewportConfig;
  onSave: (config: SpacingScaleConfig) => void | Promise<void>;
}) {
  const [config, setConfig] = useState(initialConfig);
  const dirty = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(initialConfig),
    [config, initialConfig]
  );
  const preview = useMemo(() => {
    try {
      return generateSpacingScale(config, viewport);
    } catch {
      return [];
    }
  }, [config, viewport]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Num
          label="base min"
          value={config.baseMin}
          step={1}
          onChange={(baseMin) => setConfig({ ...config, baseMin })}
        />
        <Num
          label="base max"
          value={config.baseMax}
          step={1}
          onChange={(baseMax) => setConfig({ ...config, baseMax })}
        />
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          pairs
          <Switch
            checked={config.includePairs}
            onCheckedChange={(includePairs) =>
              setConfig({ ...config, includePairs })
            }
          />
        </label>
        <SaveBar
          dirty={dirty}
          onSave={() => void onSave(config)}
          onDiscard={() => setConfig(initialConfig)}
        />
      </div>
      <div className="space-y-1">
        {config.steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={step.name}
              onChange={(e) =>
                setConfig({
                  ...config,
                  steps: config.steps.map((s, j) =>
                    j === i ? { ...s, name: e.target.value } : s
                  ),
                })
              }
              className="h-7 w-20 font-mono text-xs"
            />
            <Num
              label="×"
              value={step.multiplier}
              step={0.25}
              onChange={(multiplier) =>
                setConfig({
                  ...config,
                  steps: config.steps.map((s, j) =>
                    j === i ? { ...s, multiplier } : s
                  ),
                })
              }
            />
            <code className="flex-1 truncate text-[11px] text-muted-foreground">
              {preview.find((p) => p.name === `${config.prefix}.${step.name}`)
                ?.value ?? ""}
            </code>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() =>
                setConfig({
                  ...config,
                  steps: config.steps.filter((_, j) => j !== i),
                })
              }
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          onClick={() =>
            setConfig({
              ...config,
              steps: [...config.steps, { name: "new", multiplier: 1 }],
            })
          }
        >
          <Plus className="h-3 w-3" /> Add step
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// TYPOGRAPHY SCALE
// ============================================================================

export function TypographyScaleEditor({
  initialConfig,
  viewport,
  onSave,
}: {
  initialConfig: TypeScaleConfig;
  viewport: ViewportConfig;
  onSave: (config: TypeScaleConfig) => void | Promise<void>;
}) {
  const [config, setConfig] = useState(initialConfig);
  const dirty = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(initialConfig),
    [config, initialConfig]
  );
  const preview = useMemo(() => {
    try {
      return generateTypeScale(config, viewport);
    } catch {
      return [];
    }
  }, [config, viewport]);

  return (
    <div className="space-y-3">
      <SaveBar
        dirty={dirty}
        onSave={() => void onSave(config)}
        onDiscard={() => setConfig(initialConfig)}
      />
      <div className="space-y-1">
        {config.steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2">
            <Num
              label="min px"
              value={step.minPx}
              step={1}
              onChange={(minPx) =>
                setConfig({
                  ...config,
                  steps: config.steps.map((s, j) =>
                    j === i ? { ...s, minPx } : s
                  ),
                })
              }
            />
            <Num
              label="max px"
              value={step.maxPx}
              step={1}
              onChange={(maxPx) =>
                setConfig({
                  ...config,
                  steps: config.steps.map((s, j) =>
                    j === i ? { ...s, maxPx } : s
                  ),
                })
              }
            />
            <code className="flex-1 truncate text-[11px] text-muted-foreground">
              {preview[i]?.value ?? ""}
            </code>
            <span
              style={{ fontSize: Math.min(step.maxPx, 28) }}
              className="shrink-0 leading-none"
            >
              Ag
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() =>
                setConfig({
                  ...config,
                  steps: config.steps.filter((_, j) => j !== i),
                })
              }
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          onClick={() =>
            setConfig({
              ...config,
              steps: [...config.steps, { minPx: 16, maxPx: 20 }],
            })
          }
        >
          <Plus className="h-3 w-3" /> Add step
        </Button>
      </div>
    </div>
  );
}
