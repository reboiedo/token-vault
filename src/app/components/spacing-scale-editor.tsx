/**
 * Spacing scale editor — faithful port of the cloud product's
 * spacing-scale-editor.tsx: base min/max + unit, a steps table with
 * auto t-shirt naming (Add Smaller / Add Larger), the @min/@max size
 * VISUALIZER bars, static fixed values, and the pairs section
 * (auto-generated adjacent pairs + custom from→to pairs). Persistence:
 * `initialConfig` + `onSave(config)`.
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  calculateStepValue,
  generateSingleStepPairs,
  generateSpacingScale,
  renameStepsByPosition,
  type SpacingPair,
  type SpacingScaleConfig,
  type ViewportConfig,
} from "@core/fluid-utils";
import { useExternalSave, type ExternalSaveProps } from "@/lib/external-save";

/**
 * Number input that commits on blur/Enter — typing doesn't clobber the
 * value mid-edit (same helper the cloud editor uses).
 */
function NumberInput({
  value,
  onCommit,
  className,
  step,
}: {
  value: number;
  onCommit: (value: number) => void;
  className?: string;
  step?: string;
}) {
  const [localValue, setLocalValue] = useState(value.toString());
  useEffect(() => setLocalValue(value.toString()), [value]);

  const commit = () => {
    const parsed = parseFloat(localValue);
    if (Number.isFinite(parsed) && parsed !== value) onCommit(parsed);
    else setLocalValue(value.toString());
  };

  return (
    <Input
      type="number"
      value={localValue}
      step={step}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className={className}
    />
  );
}

export function SpacingScaleEditor({
  initialConfig,
  viewport,
  onSave,
  ...rest
}: {
  initialConfig: SpacingScaleConfig;
  viewport: ViewportConfig;
  onSave: (config: SpacingScaleConfig) => void | Promise<void>;
} & ExternalSaveProps) {
  const [config, setConfig] = useState(initialConfig);
  const dirty = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(initialConfig),
    [config, initialConfig]
  );
  const external = useExternalSave(
    rest,
    dirty,
    () => onSave(config),
    () => setConfig(initialConfig)
  );

  const updateConfig = (updates: Partial<SpacingScaleConfig>) =>
    setConfig((prev) => ({ ...prev, ...updates }));

  const sortedSteps = useMemo(
    () => [...config.steps].sort((a, b) => a.multiplier - b.multiplier),
    [config.steps]
  );

  const generatedTokens = useMemo(() => {
    try {
      return generateSpacingScale(config, viewport);
    } catch {
      return [];
    }
  }, [config, viewport]);

  // ---- steps ---------------------------------------------------------
  const addSmallerStep = () => {
    const smallest = sortedSteps[0]?.multiplier ?? 1;
    const newSteps = [
      ...config.steps,
      { name: "tmp", multiplier: Math.max(0.05, smallest / 2) },
    ];
    updateConfig({ steps: renameStepsByPosition(newSteps) });
  };

  const addLargerStep = () => {
    const largest = sortedSteps[sortedSteps.length - 1]?.multiplier ?? 1;
    const newSteps = [
      ...config.steps,
      { name: "tmp", multiplier: largest * 1.5 },
    ];
    updateConfig({ steps: renameStepsByPosition(newSteps) });
  };

  const removeStep = (name: string) => {
    const stepToRemove = sortedSteps.find((s) => s.name === name);
    if (!stepToRemove) return;
    const renamed = renameStepsByPosition(
      config.steps.filter((s) => s.multiplier !== stepToRemove.multiplier)
    );
    const validNames = new Set(renamed.map((s) => s.name));
    updateConfig({
      steps: renamed,
      customPairs: config.customPairs.filter(
        (p) => validNames.has(p.from) && validNames.has(p.to)
      ),
    });
  };

  const updateStepMultiplier = (name: string, multiplier: number) => {
    if (multiplier <= 0) return;
    const renamed = renameStepsByPosition(
      config.steps.map((s) => (s.name === name ? { ...s, multiplier } : s))
    );
    updateConfig({ steps: renamed });
  };

  // ---- fixed values --------------------------------------------------
  const fixedValues = config.fixedSteps ?? [];

  const addFixedStep = () => {
    const existing = new Set(fixedValues.map((f) => f.value));
    let next = 4;
    while (existing.has(next)) next *= 2;
    updateConfig({
      fixedSteps: [...fixedValues, { value: next }].sort(
        (a, b) => a.value - b.value
      ),
    });
  };

  const updateFixedStep = (index: number, value: number) => {
    const rounded = Math.round(value);
    if (rounded <= 0) return;
    if (fixedValues.some((f, i) => i !== index && f.value === rounded)) return;
    updateConfig({
      fixedSteps: fixedValues
        .map((f, i) => (i === index ? { value: rounded } : f))
        .sort((a, b) => a.value - b.value),
    });
  };

  // ---- pairs ---------------------------------------------------------
  const autoGeneratedPairs = useMemo(
    () => generateSingleStepPairs(sortedSteps),
    [sortedSteps]
  );

  const addCustomPair = () => {
    if (sortedSteps.length < 2) return;
    const from = sortedSteps[0].name;
    const to = sortedSteps[sortedSteps.length - 1].name;
    if (config.customPairs.some((p) => p.from === from && p.to === to)) return;
    updateConfig({ customPairs: [...config.customPairs, { from, to }] });
  };

  const updateCustomPair = (index: number, updates: Partial<SpacingPair>) =>
    updateConfig({
      customPairs: config.customPairs.map((p, i) =>
        i === index ? { ...p, ...updates } : p
      ),
    });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          Viewport: {viewport.minWidth}px – {viewport.maxWidth}px
        </span>
        {dirty && !external && (
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="sm" className="h-7" onClick={() => void onSave(config)}>
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => setConfig(initialConfig)}
            >
              Discard
            </Button>
          </div>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Spacing Scale</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Base size & settings */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label className="text-xs">Base Min</Label>
              <div className="flex items-center gap-1">
                <NumberInput
                  value={config.baseMin}
                  onCommit={(baseMin) => updateConfig({ baseMin })}
                  className="h-8"
                />
                <span className="text-xs text-muted-foreground">px</span>
              </div>
            </div>
            <div>
              <Label className="text-xs">Base Max</Label>
              <div className="flex items-center gap-1">
                <NumberInput
                  value={config.baseMax}
                  onCommit={(baseMax) => updateConfig({ baseMax })}
                  className="h-8"
                />
                <span className="text-xs text-muted-foreground">px</span>
              </div>
            </div>
            <div>
              <Label className="text-xs">Unit</Label>
              <Select
                value={config.unit}
                onValueChange={(unit) =>
                  unit && updateConfig({ unit: unit as "rem" | "px" })
                }
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rem">rem</SelectItem>
                  <SelectItem value="px">px</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Steps table with size visualizer */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Steps</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={addSmallerStep}
                className="h-7 text-xs"
              >
                <Plus className="mr-1 h-3 w-3" />
                Add Smaller
              </Button>
            </div>
            <Table className="w-auto">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Name</TableHead>
                  <TableHead className="w-24">Multiplier</TableHead>
                  <TableHead className="pr-8">@min</TableHead>
                  <TableHead>@max</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedSteps.map((step) => {
                  const minPx = calculateStepValue(step.multiplier, config.baseMin);
                  const maxPx = calculateStepValue(step.multiplier, config.baseMax);
                  const isBase = step.name === "s";
                  return (
                    <TableRow key={step.name} className="group">
                      <TableCell className="font-mono font-medium">
                        {step.name}
                        {isBase && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            (base)
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {isBase ? (
                          <span className="font-mono text-muted-foreground">1</span>
                        ) : (
                          <NumberInput
                            value={step.multiplier}
                            onCommit={(v) => updateStepMultiplier(step.name, v)}
                            className="h-7 w-20 font-mono"
                            step="0.05"
                          />
                        )}
                      </TableCell>
                      <TableCell className="pr-8">
                        <div className="space-y-1">
                          <span className="font-mono text-sm text-muted-foreground">
                            {minPx}px
                          </span>
                          <div
                            className="h-3 rounded-sm bg-primary/30"
                            style={{ width: Math.min(minPx, 200) }}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <span className="font-mono text-sm text-muted-foreground">
                            {maxPx}px
                          </span>
                          <div
                            className="h-3 rounded-sm bg-primary/30"
                            style={{ width: Math.min(maxPx, 200) }}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        {!isBase && config.steps.length > 1 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100"
                            onClick={() => removeStep(step.name)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Button
              variant="outline"
              size="sm"
              onClick={addLargerStep}
              className="h-7 text-xs"
            >
              <Plus className="mr-1 h-3 w-3" />
              Add Larger
            </Button>
          </div>

          {/* Fixed values */}
          <div className="space-y-2 border-t pt-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Fixed values (px)</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={addFixedStep}
                className="h-7 text-xs"
              >
                <Plus className="mr-1 h-3 w-3" />
                Add value
              </Button>
            </div>
            {fixedValues.length > 0 ? (
              <>
                <div className="flex flex-wrap gap-2">
                  {fixedValues.map((f, index) => (
                    <div
                      key={f.value}
                      className="group flex items-center gap-1 rounded-md border px-1.5 py-1"
                    >
                      <NumberInput
                        value={f.value}
                        onCommit={(v) => updateFixedStep(index, v)}
                        className="h-6 w-14 font-mono text-xs"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 opacity-0 group-hover:opacity-100"
                        onClick={() =>
                          updateConfig({
                            fixedSteps: fixedValues.filter((_, i) => i !== index),
                          })
                        }
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Emitted as static tokens (no viewport scaling):{" "}
                  {fixedValues.map((f) => `${config.prefix}.${f.value}`).join(", ")}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Static px values that don&apos;t scale with the viewport — e.g. 2, 4, 8.
              </p>
            )}
          </div>

          {/* Pairs */}
          <div className="space-y-3 border-t pt-2">
            <div className="flex items-center gap-2">
              <Switch
                id="spacing-pairs"
                checked={config.includePairs}
                onCheckedChange={(includePairs) => updateConfig({ includePairs })}
              />
              <Label htmlFor="spacing-pairs" className="text-xs">
                Include pairs
              </Label>
            </div>

            {config.includePairs && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Auto-generated pairs:{" "}
                  {autoGeneratedPairs.map((p) => `${p.from}-${p.to}`).join(", ")}
                </Label>

                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">
                    Custom pairs
                  </Label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addCustomPair}
                    className="h-7 text-xs"
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Add Pair
                  </Button>
                </div>

                {config.customPairs.length > 0 && (
                  <Table className="w-auto">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-24">From</TableHead>
                        <TableHead className="w-24">To</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {config.customPairs.map((pair, index) => (
                        <TableRow key={index} className="group">
                          <TableCell>
                            <Select
                              value={pair.from}
                              onValueChange={(v) =>
                                v && updateCustomPair(index, { from: v })
                              }
                            >
                              <SelectTrigger className="h-7 w-20">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {sortedSteps.map((s) => (
                                  <SelectItem key={s.name} value={s.name}>
                                    {s.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Select
                              value={pair.to}
                              onValueChange={(v) =>
                                v && updateCustomPair(index, { to: v })
                              }
                            >
                              <SelectTrigger className="h-7 w-20">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {sortedSteps.map((s) => (
                                  <SelectItem key={s.name} value={s.name}>
                                    {s.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 opacity-0 group-hover:opacity-100"
                              onClick={() =>
                                updateConfig({
                                  customPairs: config.customPairs.filter(
                                    (_, i) => i !== index
                                  ),
                                })
                              }
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Generated tokens preview */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">
            Generated Tokens ({generatedTokens.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-48 space-y-1 overflow-y-auto font-mono text-xs">
            {generatedTokens.map((token, i) => (
              <div key={i} className="flex justify-between py-0.5">
                <span className="text-muted-foreground">{token.name}</span>
                <span className="max-w-[60%] truncate text-primary">
                  {token.value}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
