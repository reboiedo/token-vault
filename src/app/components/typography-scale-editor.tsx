"use client";

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import {
  TypeScaleConfig,
  TypeStep,
  ViewportConfig,
  generateTypeScale,
  defaultTypeScale,
} from "@core/fluid-utils";
import { useExternalSave, type ExternalSaveProps } from "@/lib/external-save";

// ============================================================================
// Types
// ============================================================================

// Standalone typography config that lives on the collection
export interface StandaloneTypographyConfig {
  steps: TypeStep[];
  unit: "rem" | "px";
  prefix: string;
  baseStepIndex?: number; // Index of step-1 (base) among fluid steps. Defaults to 0.
}

// ============================================================================
// Input Components
// ============================================================================

function NumberInput({
  value,
  onCommit,
  className,
  step = "1",
}: {
  value: number;
  onCommit: (value: number) => void;
  className?: string;
  step?: string;
}) {
  const [localValue, setLocalValue] = useState(value.toString());

  useEffect(() => {
    setLocalValue(value.toString());
  }, [value]);

  return (
    <Input
      type="number"
      step={step}
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={() => {
        const parsed = parseFloat(localValue);
        if (!isNaN(parsed) && parsed > 0) {
          onCommit(parsed);
        } else {
          setLocalValue(value.toString());
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
      className={`[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${className}`}
    />
  );
}

// ============================================================================
// Type Scale Chart Component
// ============================================================================

function calculateFontSizeAtViewport(
  minPx: number,
  maxPx: number,
  viewportWidth: number,
  minViewport: number,
  maxViewport: number
): number {
  if (minPx === maxPx) return minPx;
  if (viewportWidth <= minViewport) return minPx;
  if (viewportWidth >= maxViewport) return maxPx;
  const progress = (viewportWidth - minViewport) / (maxViewport - minViewport);
  return minPx + (maxPx - minPx) * progress;
}

interface TypeScaleChartProps {
  steps: TypeStep[];
  viewport: ViewportConfig;
  breakpoints?: number[];
  getStepName: (step: TypeStep, index: number) => string;
}

const STANDARD_X_TICKS = [320, 480, 640, 800, 960, 1120, 1280, 1440, 1600, 1760, 1920, 2080, 2240];

function calculateNiceYAxis(maxValue: number): { max: number; interval: number; ticks: number[] } {
  const niceIntervals = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

  for (const interval of niceIntervals) {
    const max = Math.ceil(maxValue / interval) * interval;
    const tickCount = max / interval;

    if (tickCount >= 4 && tickCount <= 10) {
      const ticks: number[] = [];
      for (let i = 0; i <= tickCount; i++) {
        ticks.push(i * interval);
      }
      return { max, interval, ticks };
    }
  }

  const interval = 20;
  const max = Math.ceil(maxValue / interval) * interval;
  const ticks: number[] = [];
  for (let i = 0; i <= max / interval; i++) {
    ticks.push(i * interval);
  }
  return { max, interval, ticks };
}

function TypeScaleChart({ steps, viewport, breakpoints = [], getStepName }: TypeScaleChartProps) {
  const keyBreakpoints = useMemo(() => {
    return [viewport.minWidth, ...breakpoints, viewport.maxWidth].sort((a, b) => a - b);
  }, [viewport, breakpoints]);

  const xAxisConfig = useMemo(() => {
    const { minWidth, maxWidth } = viewport;
    const padding = 160;
    const minX = Math.max(160, Math.floor((minWidth - padding) / 160) * 160);
    const maxX = Math.ceil((maxWidth + padding) / 160) * 160;
    const ticks = STANDARD_X_TICKS.filter(t => t >= minX && t <= maxX);
    return { min: minX, max: maxX, ticks };
  }, [viewport]);

  const chartData = useMemo(() => {
    const { minWidth, maxWidth } = viewport;
    const { min: xMin, max: xMax } = xAxisConfig;

    const allPoints = new Set<number>([
      xMin,
      ...xAxisConfig.ticks,
      ...keyBreakpoints,
      xMax,
    ]);

    for (let x = minWidth; x <= maxWidth; x += 100) {
      allPoints.add(x);
    }

    const viewportPoints = Array.from(allPoints).sort((a, b) => a - b);

    const data: Array<Record<string, number | boolean>> = viewportPoints.map(vw => {
      const isBreakpoint = keyBreakpoints.includes(vw);
      const point: Record<string, number | boolean> = {
        viewport: vw,
        isBreakpoint,
      };
      steps.forEach((s, idx) => {
        point[`step${idx}`] = Math.round(
          calculateFontSizeAtViewport(s.minPx, s.maxPx, vw, minWidth, maxWidth) * 100
        ) / 100;
      });
      return point;
    });

    return data;
  }, [steps, viewport, keyBreakpoints, xAxisConfig]);

  const yAxisConfig = useMemo(() => {
    const maxValue = Math.max(...steps.map(s => Math.max(s.minPx, s.maxPx)));
    return calculateNiceYAxis(maxValue);
  }, [steps]);

  if (steps.length === 0) return null;

  const [hoveredPoint, setHoveredPoint] = useState<{
    x: number;
    y: number;
    viewport: number;
    stepName: string;
    value: number;
  } | null>(null);

  const renderDot = (stepIdx: number) => (props: { cx?: number; cy?: number; payload?: Record<string, unknown>; index?: number }) => {
    const { cx, cy, payload, index = 0 } = props;
    if (!payload?.isBreakpoint || cx === undefined || cy === undefined) {
      return <g key={`empty-${stepIdx}-${index}`} />;
    }
    const value = payload[`step${stepIdx}`] as number;
    const vp = payload.viewport as number;
    return (
      <circle
        key={`dot-${stepIdx}-${vp}`}
        cx={cx}
        cy={cy}
        r={5}
        fill="currentColor"
        stroke="white"
        strokeWidth={2}
        style={{ cursor: 'pointer' }}
        onMouseEnter={() => setHoveredPoint({
          x: cx,
          y: cy,
          viewport: vp,
          stepName: getStepName(steps[stepIdx], stepIdx),
          value,
        })}
        onMouseLeave={() => setHoveredPoint(null)}
      />
    );
  };

  return (
    <div className="relative overflow-hidden text-foreground">
      <Label className="text-xs text-muted-foreground mb-2 block">Scale Visualization</Label>
      <div className="h-[600px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
            <CartesianGrid
              strokeDasharray="4 4"
              stroke="#e0e0e0"
            />
            <XAxis
              dataKey="viewport"
              type="number"
              domain={[xAxisConfig.min, xAxisConfig.max]}
              ticks={xAxisConfig.ticks}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10 }}
              tickMargin={8}
            />
            <YAxis
              domain={[0, yAxisConfig.max]}
              ticks={yAxisConfig.ticks}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10 }}
              tickMargin={4}
              width={40}
            />
            {steps.map((_, idx) => (
              <Line
                key={`line-${idx}`}
                type="linear"
                dataKey={`step${idx}`}
                stroke="currentColor"
                strokeWidth={1.5}
                dot={renderDot(idx)}
                activeDot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {hoveredPoint && (
        <div
          className="absolute pointer-events-none z-50 bg-popover border border-border rounded-lg px-3 py-2 shadow-lg"
          style={{
            left: hoveredPoint.x + 60,
            top: hoveredPoint.y + 80,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="text-xs font-medium mb-1">{hoveredPoint.viewport}px</div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{hoveredPoint.stepName}:</span>
            <span className="text-xs font-mono font-medium">{hoveredPoint.value}px</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Editor Component
// ============================================================================

interface TypographyScaleEditorProps extends ExternalSaveProps {
  initialConfig?: StandaloneTypographyConfig;
  viewport: ViewportConfig;
  breakpoints?: number[];
  onSave: (config: StandaloneTypographyConfig) => void | Promise<void>;
}

export function TypographyScaleEditor({
  initialConfig,
  viewport,
  breakpoints = [],
  onSave,
  ...rest
}: TypographyScaleEditorProps) {
  // Local config state
  const [config, setConfig] = useState<StandaloneTypographyConfig>(
    initialConfig ?? { ...defaultTypeScale }
  );
  const isDirty = useMemo(
    () =>
      JSON.stringify(config) !==
      JSON.stringify(initialConfig ?? { ...defaultTypeScale }),
    [config, initialConfig]
  );
  const external = useExternalSave(
    rest,
    isDirty,
    () => onSave(config),
    () => setConfig(initialConfig ?? { ...defaultTypeScale })
  );

  // Group fixed steps (minPx === maxPx) at the top, then fluid steps.
  // Within each group, sort by minPx ascending. The visual list reads
  // naturally — fixed sizes (12, 14) before the scale (16, 20, 24, …) —
  // and fluidStepIndices / base-step offsets below still resolve
  // correctly because they look up by `sortedSteps` position.
  const sortedSteps = useMemo(() => {
    const fixed = config.steps
      .filter((s) => s.minPx === s.maxPx)
      .sort((a, b) => a.minPx - b.minPx);
    const fluid = config.steps
      .filter((s) => s.minPx !== s.maxPx)
      .sort((a, b) => a.minPx - b.minPx);
    return [...fixed, ...fluid];
  }, [config.steps]);

  // Generate tokens for preview/save
  const generatedTokens = useMemo(() => {
    return generateTypeScale(config, viewport);
  }, [config, viewport]);

  // Update config helper
  const updateConfig = useCallback((updates: Partial<StandaloneTypographyConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  }, []);

  // Step management
  const addStep = useCallback(() => {
    const largest = sortedSteps[sortedSteps.length - 1];
    const newMinPx = largest ? Math.round(largest.minPx * 1.25) : 16;
    const newMaxPx = largest ? Math.round(largest.maxPx * 1.25) : 18;
    const newSteps = [...config.steps, { minPx: newMinPx, maxPx: newMaxPx }];
    updateConfig({ steps: newSteps });
  }, [sortedSteps, config.steps, updateConfig]);

  const removeStep = useCallback((index: number) => {
    if (config.steps.length <= 1) return;
    const stepToRemove = sortedSteps[index];
    if (!stepToRemove) return;

    const newSteps = config.steps.filter(
      s => !(s.minPx === stepToRemove.minPx && s.maxPx === stepToRemove.maxPx)
    );
    updateConfig({ steps: newSteps });
  }, [config, sortedSteps, updateConfig]);

  const updateStepValue = useCallback((index: number, field: "minPx" | "maxPx", value: number) => {
    const stepToUpdate = sortedSteps[index];
    if (!stepToUpdate) return;

    const newSteps = config.steps.map(s => {
      if (s.minPx === stepToUpdate.minPx && s.maxPx === stepToUpdate.maxPx) {
        return { ...s, [field]: value };
      }
      return s;
    });
    updateConfig({ steps: newSteps });
  }, [sortedSteps, config.steps, updateConfig]);

  // Build list of fluid step indices
  const fluidStepIndices = useMemo(() => {
    const indices: number[] = [];
    sortedSteps.forEach((step, idx) => {
      if (step.minPx !== step.maxPx) {
        indices.push(idx);
      }
    });
    return indices;
  }, [sortedSteps]);

  // Get the base step index (clamped to valid range)
  const effectiveBaseIndex = useMemo(() => {
    const base = config.baseStepIndex ?? 0;
    return Math.max(0, Math.min(base, fluidStepIndices.length - 1));
  }, [config.baseStepIndex, fluidStepIndices.length]);

  // Generate step name for display
  const getStepName = useCallback((step: TypeStep, sortedIndex: number): string => {
    if (step.minPx === step.maxPx) {
      return `${step.minPx}`;
    }
    // Calculate position relative to base
    const fluidPosition = fluidStepIndices.indexOf(sortedIndex);
    const relativePosition = fluidPosition - effectiveBaseIndex;

    const stepNumber = relativePosition >= 0 ? relativePosition + 1 : relativePosition;
    return `step-${stepNumber}`;
  }, [fluidStepIndices, effectiveBaseIndex]);

  // Get the fluid index of a step (for UI purposes)
  const getFluidIndex = useCallback((sortedIndex: number): number => {
    return fluidStepIndices.indexOf(sortedIndex);
  }, [fluidStepIndices]);

  // Check if a step is the base step
  const isBaseStep = useCallback((sortedIndex: number): boolean => {
    const fluidPosition = fluidStepIndices.indexOf(sortedIndex);
    return fluidPosition === effectiveBaseIndex;
  }, [fluidStepIndices, effectiveBaseIndex]);

  // Set a step as the base step
  const setAsBaseStep = useCallback((sortedIndex: number) => {
    const fluidPosition = fluidStepIndices.indexOf(sortedIndex);
    if (fluidPosition >= 0) {
      updateConfig({ baseStepIndex: fluidPosition });
    }
  }, [fluidStepIndices, updateConfig]);

  // Save changes
  return (
    <div className="space-y-6">
      {isDirty && !external && (
        <div className="flex items-center gap-1.5">
          <Button size="sm" className="h-7" onClick={() => void onSave(config)}>
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => setConfig(initialConfig ?? { ...defaultTypeScale })}
          >
            Discard
          </Button>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">
            Viewport: {viewport.minWidth}px - {viewport.maxWidth}px
            {breakpoints.length > 0 && (
              <span className="text-muted-foreground ml-2">
                (Breakpoints: {breakpoints.join(", ")}px)
              </span>
            )}
          </CardTitle>
        </CardHeader>
      </Card>

      {/* Main Typography Editor */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Typography Scale</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 overflow-x-hidden">
          {/* Settings */}
          <div className="grid grid-cols-2 gap-4">
            {false && (
              <div>
                <Label className="text-xs">Prefix</Label>
                <Input
                  value={config.prefix}
                  onChange={e => updateConfig({ prefix: e.target.value })}
                  className="h-8"
                />
              </div>
            )}
            <div>
              <Label className="text-xs">Unit</Label>
              <Select
                value={config.unit}
                onValueChange={(value) => value && updateConfig({ unit: value as "rem" | "px" })}
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

          {/* Steps and Chart side by side */}
          <div className="flex flex-wrap gap-6">
            {/* Steps Table */}
            <div className="space-y-2 flex-shrink-0">
              <Label className="text-xs text-muted-foreground">Steps</Label>
              <Table className="w-auto">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Name</TableHead>
                    <TableHead>@min (px)</TableHead>
                    <TableHead>@max (px)</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedSteps.map((step, index) => {
                    const stepName = getStepName(step, index);
                    const isFluid = step.minPx !== step.maxPx;
                    const isBase = isBaseStep(index);

                    return (
                      <TableRow key={`${step.minPx}-${step.maxPx}-${index}`} className="group align-bottom">
                        <TableCell className="font-mono font-medium align-bottom">
                          <div className="flex items-center gap-2">
                            <span className={isBase ? "text-primary" : ""}>
                              {config.prefix}.{stepName}
                            </span>
                            {isBase && (
                              <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                base
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="align-bottom pr-8">
                          <div className="flex items-end gap-2">
                            <NumberInput
                              value={step.minPx}
                              onCommit={(value) => updateStepValue(index, "minPx", value)}
                              className="h-7 w-20 font-mono"
                            />
                            <span
                              className="text-muted-foreground"
                              style={{ fontSize: `${step.minPx}px`, lineHeight: 1 }}
                            >
                              aA
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="align-bottom">
                          <div className="flex items-end gap-2">
                            <NumberInput
                              value={step.maxPx}
                              onCommit={(value) => updateStepValue(index, "maxPx", value)}
                              className="h-7 w-20 font-mono"
                            />
                            <span
                              className="text-muted-foreground"
                              style={{ fontSize: `${step.maxPx}px`, lineHeight: 1 }}
                            >
                              aA
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="align-bottom">
                          <div className="flex items-center gap-1">
                            {isFluid && !isBase && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-[10px] opacity-0 group-hover:opacity-100"
                                onClick={() => setAsBaseStep(index)}
                              >
                                Set as base
                              </Button>
                            )}
                            {config.steps.length > 1 && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 opacity-0 group-hover:opacity-100"
                                onClick={() => removeStep(index)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <Button
                variant="outline"
                size="sm"
                onClick={addStep}
                className="h-7 text-xs"
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Step
              </Button>
            </div>

            {/* Type Scale Chart */}
            <div className="flex-1 min-w-[400px]">
              <TypeScaleChart
                steps={sortedSteps}
                viewport={viewport}
                breakpoints={breakpoints}
                getStepName={(step, idx) => getStepName(step, idx)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Token Preview */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">
            Generated Tokens ({generatedTokens.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-48 overflow-y-auto space-y-1 text-xs font-mono">
            {generatedTokens.map((token, i) => (
              <div key={i} className="flex justify-between py-0.5">
                <span className="text-muted-foreground">{token.name}</span>
                <span className="text-primary truncate max-w-[60%]">{token.value}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
