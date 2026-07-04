"use client";

import { useCallback, useRef, useState, useMemo } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ColorFamily,
  ChannelConfig,
  CurveType,
  getChannelValues,
  generateFamilyColors,
  getRelativeLuminance,
  getWcag2ContrastRatio,
  getApcaContrast,
  buildChannelAnchors,
  generateMonotonicSplinePath,
  hexToOklch,
} from "@core/color-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface CombinedCurveGraphProps {
  family: ColorFamily;
  steps: string[];
  height?: number;
  channelOverrides?: {
    lightness?: ChannelConfig;
    chroma?: ChannelConfig;
    hue?: ChannelConfig;
  };
  previewCurves?: {
    lightness?: CurveType | null;
    chroma?: CurveType | null;
    hue?: CurveType | null;
  };
  onOverride: (
    channel: "lightness" | "chroma" | "hue",
    step: string,
    value: number
  ) => void;
  onStartEndChange: (
    channel: "lightness" | "chroma" | "hue",
    field: "start" | "end",
    value: number
  ) => void;
  onCustomCurve: (
    channel: "lightness" | "chroma" | "hue",
    bezier: [number, number, number, number]
  ) => void;
  onClearOverride: (channel: "lightness" | "chroma" | "hue", step: string) => void;
  onOffsetChannel?: (
    channel: "lightness" | "chroma" | "hue",
    delta: number
  ) => void;
  onLockShadeToColor?: (step: string, oklch: { l: number; c: number; h: number }) => void;
  onUnlockShade?: (step: string) => void;
  className?: string;
}

type ChannelKey = "lightness" | "chroma" | "hue";

interface ChannelMeta {
  key: ChannelKey;
  label: string;
  shortLabel: string;
  min: number;
  max: number;
  isHue: boolean;
}

// Channel order: H, C, L (OKLCH)
const CHANNELS: ChannelMeta[] = [
  { key: "hue", label: "Hue", shortLabel: "H", min: 0, max: 360, isHue: true },
  { key: "chroma", label: "Chroma", shortLabel: "C", min: 0, max: 0.4, isHue: false },
  { key: "lightness", label: "Lightness", shortLabel: "L", min: 0, max: 1, isHue: false },
];

// Visual padding percentage for top/bottom edges (handles won't touch edges)
const EDGE_PADDING = 8; // percentage

export function CombinedCurveGraph({
  family,
  steps,
  height = 500,
  channelOverrides,
  previewCurves,
  onOverride,
  onStartEndChange,
  onCustomCurve,
  onClearOverride,
  onOffsetChannel,
  onLockShadeToColor,
  onUnlockShade,
  className,
}: CombinedCurveGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleChannels, setVisibleChannels] = useState<Set<ChannelKey>>(
    new Set(["lightness", "chroma", "hue"])
  );
  const [dragging, setDragging] = useState<{
    channel: ChannelKey;
    index: number;
    type: "point" | "handleIn" | "handleOut" | "curve";
    startY?: number; // For curve dragging - initial Y position
  } | null>(null);
  const [hovering, setHovering] = useState<{
    channel: ChannelKey;
    index: number;
  } | null>(null);
  const [hoveringCurve, setHoveringCurve] = useState<ChannelKey | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<{
    channel: ChannelKey;
    index: number;
  } | null>(null);
  const [showLuminance, setShowLuminance] = useState(false);
  const [contrastMode, setContrastMode] = useState<"off" | "wcag2" | "wcag3">("off");

  // State for hex color input popover
  const [colorInputStep, setColorInputStep] = useState<number | null>(null);
  const [hexInputValue, setHexInputValue] = useState("");
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);

  // Generate colors for background columns
  const colors = useMemo(
    () => generateFamilyColors(family, steps, channelOverrides),
    [family, steps, channelOverrides]
  );

  // Generate preview colors when hovering over curve options
  const previewColors = useMemo(() => {
    if (!previewCurves) return null;

    // Check if any preview curve is set
    const hasPreview = previewCurves.lightness || previewCurves.chroma || previewCurves.hue;
    if (!hasPreview) return null;

    // Create a modified family with preview curves applied
    const previewFamily: ColorFamily = {
      ...family,
      lightness: previewCurves.lightness
        ? { ...family.lightness, curve: previewCurves.lightness }
        : family.lightness,
      chroma: previewCurves.chroma
        ? { ...family.chroma, curve: previewCurves.chroma }
        : family.chroma,
      hue: previewCurves.hue
        ? { ...family.hue, curve: previewCurves.hue }
        : family.hue,
    };

    return generateFamilyColors(previewFamily, steps, channelOverrides);
  }, [previewCurves, family, steps, channelOverrides]);

  // Use preview colors if available, otherwise use regular colors
  const displayColors = previewColors ?? colors;

  // Get values for each channel
  // When a channel is synced (has override), show the override channel's curve
  const channelValues = useMemo(() => {
    // Use override config if provided, otherwise use family's own config
    const lightnessConfig = channelOverrides?.lightness ?? family.lightness;
    const chromaConfig = channelOverrides?.chroma ?? family.chroma;
    const hueConfig = channelOverrides?.hue ?? family.hue;

    return {
      lightness: getChannelValues(lightnessConfig, steps, false),
      chroma: getChannelValues(chromaConfig, steps, false),
      hue: getChannelValues(hueConfig, steps, true),
    };
  }, [family, steps, channelOverrides]);

  // Compute preview values when hovering over curve options
  const previewChannelValues = useMemo(() => {
    if (!previewCurves) return null;

    const result: Partial<Record<ChannelKey, ReturnType<typeof getChannelValues>>> = {};

    for (const channel of ["lightness", "chroma", "hue"] as const) {
      const previewCurve = previewCurves[channel];
      if (previewCurve) {
        const baseConfig = channelOverrides?.[channel] ?? family[channel];
        const previewConfig: ChannelConfig = {
          ...baseConfig,
          curve: previewCurve,
        };
        result[channel] = getChannelValues(previewConfig, steps, channel === "hue");
      }
    }

    return Object.keys(result).length > 0 ? result : null;
  }, [previewCurves, channelOverrides, family, steps]);

  // Compute luminance and contrast values for each color (use display colors for preview)
  const colorMetrics = useMemo(() => {
    return displayColors.map(({ hex }) => {
      const luminance = getRelativeLuminance(hex);
      const wcag2White = getWcag2ContrastRatio(hex, "#ffffff");
      const wcag2Black = getWcag2ContrastRatio(hex, "#000000");
      const apcaWhite = Math.abs(getApcaContrast("#ffffff", hex));
      const apcaBlack = Math.abs(getApcaContrast("#000000", hex));
      return {
        luminance,
        wcag2White,
        wcag2Black,
        apcaWhite,
        apcaBlack,
      };
    });
  }, [displayColors]);

  // Column width calculation
  const columnWidth = 100 / steps.length;

  // Y scale: normalize value to percentage (0-100)
  // Y scale with visual padding: values can reach limits but handles don't touch edges
  const yScale = useCallback(
    (value: number, meta: ChannelMeta) => {
      const normalized = (value - meta.min) / (meta.max - meta.min);
      // Map to visual range with padding: EDGE_PADDING to (100 - EDGE_PADDING)
      const visualRange = 100 - 2 * EDGE_PADDING;
      return EDGE_PADDING + (1 - normalized) * visualRange; // Invert: 0 at top, 100 at bottom
    },
    []
  );

  const yScaleInverse = useCallback(
    (percent: number, meta: ChannelMeta) => {
      // Map from visual range back to normalized value
      const visualRange = 100 - 2 * EDGE_PADDING;
      const normalized = 1 - (percent - EDGE_PADDING) / visualRange;
      return meta.min + normalized * (meta.max - meta.min);
    },
    []
  );

  // Calculate x position - center of each column
  const getXPosition = useCallback(
    (index: number, total: number) => {
      // Center of each column: (index + 0.5) / total * 100
      return ((index + 0.5) / total) * 100;
    },
    []
  );

  // Handle drag for points
  const handlePointerDown = useCallback(
    (e: React.PointerEvent, channel: ChannelKey, index: number, type: "point" | "handleIn" | "handleOut" = "point") => {
      e.preventDefault();
      e.stopPropagation();
      setDragging({ channel, index, type });
      if (type === "point") {
        setSelectedPoint({ channel, index });
      }
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    []
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging || !containerRef.current) return;

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const graphTop = 40; // Header height
      const graphHeight = rect.height - graphTop - 40; // Bottom padding

      const y = e.clientY - rect.top - graphTop;
      const yPercent = Math.max(0, Math.min(100, (y / graphHeight) * 100));

      const meta = CHANNELS.find((c) => c.key === dragging.channel)!;

      // Handle curve dragging (offset entire channel)
      if (dragging.type === "curve") {
        if (dragging.startY !== undefined && onOffsetChannel) {
          const currentY = e.clientY;
          const deltaPixels = dragging.startY - currentY; // Positive = dragging up = increase value
          const deltaPercent = (deltaPixels / graphHeight) * 100;
          const visualRange = 100 - 2 * EDGE_PADDING;
          const deltaNormalized = deltaPercent / visualRange;
          const deltaValue = deltaNormalized * (meta.max - meta.min);

          // Round appropriately
          let roundedDelta = deltaValue;
          if (meta.isHue) {
            roundedDelta = Math.round(deltaValue);
          } else if (meta.max <= 1) {
            roundedDelta = Math.round(deltaValue * 100) / 100;
          } else {
            roundedDelta = Math.round(deltaValue * 10) / 10;
          }

          if (Math.abs(roundedDelta) > 0.001) {
            onOffsetChannel(dragging.channel, roundedDelta);
            // Update startY for continuous dragging
            setDragging(prev => prev ? { ...prev, startY: currentY } : null);
          }
        }
        return;
      }

      // Handle point dragging
      if (dragging.type !== "point") return;

      const n = steps.length;
      const isFirst = dragging.index === 0;
      const isLast = dragging.index === n - 1;

      // Calculate new value from mouse position
      let newValue = yScaleInverse(yPercent, meta);

      // Clamp and round
      newValue = Math.max(meta.min, Math.min(meta.max, newValue));
      if (meta.isHue) {
        newValue = Math.round(newValue);
      } else if (meta.max <= 1) {
        newValue = Math.round(newValue * 100) / 100;
      } else {
        newValue = Math.round(newValue * 10) / 10;
      }

      if (isFirst) {
        // First point controls channel.start - spline recalculates
        onStartEndChange(dragging.channel, "start", newValue);
      } else if (isLast) {
        // Last point controls channel.end - spline recalculates
        onStartEndChange(dragging.channel, "end", newValue);
      } else {
        // Middle points create overrides (become active anchors)
        const step = steps[dragging.index];
        onOverride(dragging.channel, step, newValue);
      }
    },
    [dragging, steps, yScaleInverse, onOverride, onStartEndChange, onOffsetChannel]
  );

  const handlePointerUp = useCallback(() => {
    setDragging(null);
  }, []);

  const handleDoubleClick = useCallback(
    (channel: ChannelKey, index: number) => {
      const values = channelValues[channel];
      if (values[index].isOverride) {
        onClearOverride(channel, steps[index]);
      }
    },
    [channelValues, steps, onClearOverride]
  );

  const toggleChannel = (channel: ChannelKey) => {
    setVisibleChannels((prev) => {
      const next = new Set(prev);
      if (next.has(channel)) {
        next.delete(channel);
      } else {
        next.add(channel);
      }
      return next;
    });
  };

  // Check if a shade step has all 3 channels locked (all have overrides)
  const isShadeFullyLocked = useCallback(
    (stepIndex: number) => {
      const step = steps[stepIndex];
      const lOverride = channelValues.lightness[stepIndex]?.isOverride;
      const cOverride = channelValues.chroma[stepIndex]?.isOverride;
      const hOverride = channelValues.hue[stepIndex]?.isOverride;
      return lOverride && cOverride && hOverride;
    },
    [channelValues, steps]
  );

  // Handle locking to hex color
  const handleLockToHex = useCallback(
    (hex: string) => {
      if (colorInputStep === null || !onLockShadeToColor) return;
      try {
        const oklch = hexToOklch(hex);
        onLockShadeToColor(steps[colorInputStep], oklch);
        setColorInputStep(null);
        setHexInputValue("");
      } catch (e) {
        // Invalid hex, don't do anything
      }
    },
    [colorInputStep, steps, onLockShadeToColor]
  );

  // Handle unlocking a shade
  const handleUnlock = useCallback(() => {
    if (colorInputStep === null || !onUnlockShade) return;
    onUnlockShade(steps[colorInputStep]);
    setColorInputStep(null);
    setHexInputValue("");
  }, [colorInputStep, steps, onUnlockShade]);

  // Handle column click (click vs drag detection happens in pointer handlers)
  const handleColumnClick = useCallback(
    (stepIndex: number) => {
      if (!onLockShadeToColor) return;
      // Set the current color as default value
      const currentColor = displayColors[stepIndex]?.hex || "";
      setHexInputValue(currentColor);
      setColorInputStep(stepIndex);
    },
    [displayColors, onLockShadeToColor]
  );

  // Generate SVG path for a channel using monotonic cubic spline
  const generatePath = useCallback(
    (channel: ChannelConfig, stepsArr: string[], meta: ChannelMeta) => {
      if (stepsArr.length < 1) return "";
      if (stepsArr.length === 1) {
        const x = getXPosition(0, 1);
        const y = yScale(channel.start, meta);
        return `M ${x} ${y}`;
      }

      // Build anchors from channel config
      const anchors = buildChannelAnchors(channel, stepsArr);

      // Generate smooth spline path with many points
      const splinePoints = generateMonotonicSplinePath(anchors, 50);

      // Convert to SVG coordinates
      const n = stepsArr.length;
      const graphStartX = getXPosition(0, n);
      const graphEndX = getXPosition(n - 1, n);
      const graphWidth = graphEndX - graphStartX;

      const parts: string[] = [];
      splinePoints.forEach((p, i) => {
        // Map spline x (0-1) to graph x coordinates
        const x = graphStartX + p.x * graphWidth;
        const y = yScale(p.y, meta);

        if (i === 0) {
          parts.push(`M ${x} ${y}`);
        } else {
          parts.push(`L ${x} ${y}`);
        }
      });

      return parts.join(" ");
    },
    [yScale, getXPosition]
  );

  return (
    <div
      ref={containerRef}
      className={cn("relative select-none", className)}
      style={{ height }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {/* Header with toggle buttons */}
      <div className="absolute top-0 left-0 right-0 h-10 flex items-center justify-between z-10 px-2">
        {/* Channel toggles */}
        <div className="flex items-center gap-1">
          {CHANNELS.map((meta) => (
            <Button
              key={meta.key}
              variant={visibleChannels.has(meta.key) ? "default" : "outline"}
              size="sm"
              className={cn(
                "h-7 w-7 p-0 text-xs font-bold",
                visibleChannels.has(meta.key)
                  ? "bg-zinc-800 text-white hover:bg-zinc-700"
                  : "bg-zinc-200 text-zinc-600 hover:bg-zinc-300"
              )}
              onClick={() => toggleChannel(meta.key)}
            >
              {meta.shortLabel}
            </Button>
          ))}
        </div>

        {/* Luminance and Contrast toggles */}
        <div className="flex items-center gap-3">
          {/* Luminance toggle */}
          <Button
            variant={showLuminance ? "default" : "outline"}
            size="sm"
            className={cn(
              "h-7 px-2 text-xs font-medium",
              showLuminance
                ? "bg-zinc-800 text-white hover:bg-zinc-700"
                : "bg-zinc-200 text-zinc-600 hover:bg-zinc-300"
            )}
            onClick={() => setShowLuminance(!showLuminance)}
          >
            Lum
          </Button>

          {/* Contrast toggle group */}
          <div className="flex items-center gap-0.5 bg-zinc-200 rounded-md p-0.5">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-6 px-2 text-xs font-medium rounded",
                contrastMode === "wcag2"
                  ? "bg-zinc-800 text-white hover:bg-zinc-700"
                  : "text-zinc-600 hover:bg-zinc-300"
              )}
              onClick={() => setContrastMode(contrastMode === "wcag2" ? "off" : "wcag2")}
            >
              WCAG 2
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-6 px-2 text-xs font-medium rounded",
                contrastMode === "wcag3"
                  ? "bg-zinc-800 text-white hover:bg-zinc-700"
                  : "text-zinc-600 hover:bg-zinc-300"
              )}
              onClick={() => setContrastMode(contrastMode === "wcag3" ? "off" : "wcag3")}
            >
              APCA
            </Button>
          </div>
        </div>
      </div>

      {/* Main graph area with colored columns */}
      <div
        className="absolute left-0 right-0 overflow-hidden rounded-lg"
        style={{ top: 40, bottom: 40 }}
      >
        {/* Colored columns */}
        <div className="absolute inset-0 flex">
          {displayColors.map(({ step, hex }, i) => {
            const metrics = colorMetrics[i];
            const isLight = metrics.luminance > 0.179; // Use dark text on light bg
            const textColor = isLight ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.8)";
            const isLocked = isShadeFullyLocked(i);
            const isFirst = i === 0;
            const isLast = i === steps.length - 1;
            const canLock = !isFirst && !isLast && onLockShadeToColor;

            // Convert to greyscale when luminance is shown
            // Use luminance to determine grey level (apply gamma for display)
            const greyValue = Math.round(Math.pow(metrics.luminance, 1/2.2) * 255);
            const displayColor = showLuminance
              ? `rgb(${greyValue}, ${greyValue}, ${greyValue})`
              : hex;

            return (
              <Popover
                key={step}
                open={colorInputStep === i}
                onOpenChange={(open) => {
                  if (!open) {
                    setColorInputStep(null);
                    setHexInputValue("");
                  }
                }}
              >
                <PopoverTrigger
                  render={
                  <div
                    className={cn(
                      "flex-1 transition-all duration-150 relative group",
                      canLock && "cursor-pointer"
                    )}
                    style={{ backgroundColor: displayColor }}
                    onClick={() => canLock && handleColumnClick(i)}
                  >
                    {/* Hover indicator - top border */}
                    {canLock && (
                      <div
                        className="absolute inset-x-0 top-0 h-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ backgroundColor: textColor }}
                      />
                    )}
                    {/* Lock indicator for fully-locked shades */}
                    {isLocked && (
                      <div
                        className="absolute top-1 left-1/2 -translate-x-1/2 z-10"
                        style={{ color: textColor }}
                      >
                        <Lock className="w-3 h-3" />
                      </div>
                    )}

                    {/* Values overlay - always show luminance, plus optional contrast */}
                    <div
                      className="absolute bottom-1 left-0 right-0 flex flex-col items-center gap-0.5 text-[9px] font-mono"
                      style={{ color: textColor }}
                    >
                      {/* Always show luminance value */}
                      <span>{(metrics.luminance * 100).toFixed(1)}%</span>
                      {/* Show contrast when enabled */}
                      {contrastMode === "wcag2" && (
                        <span>
                          {isLight
                            ? metrics.wcag2Black.toFixed(1)
                            : metrics.wcag2White.toFixed(1)}
                          :1
                        </span>
                      )}
                      {contrastMode === "wcag3" && (
                        <span>
                          Lc{" "}
                          {isLight
                            ? metrics.apcaBlack.toFixed(0)
                            : metrics.apcaWhite.toFixed(0)}
                        </span>
                      )}
                    </div>
                  </div>
                }
                />
                <PopoverContent className="w-56 p-3" side="top">
                  <div className="space-y-3">
                    <div className="text-sm font-medium">Lock to hex color</div>
                    <Input
                      placeholder="#3B82F6"
                      value={hexInputValue}
                      onChange={(e) => setHexInputValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleLockToHex(hexInputValue);
                        } else if (e.key === "Escape") {
                          setColorInputStep(null);
                          setHexInputValue("");
                        }
                      }}
                      className="font-mono"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleLockToHex(hexInputValue)}
                        className="flex-1"
                      >
                        Lock
                      </Button>
                      {isLocked && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleUnlock}
                          className="flex-1"
                        >
                          Unlock
                        </Button>
                      )}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            );
          })}
        </div>

        {/* SVG overlay for curves */}
        <svg
          className="absolute inset-0 w-full h-full overflow-visible"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ pointerEvents: "none" }}
        >
          {/* Render curves using monotonic spline */}
          {CHANNELS.map((meta) => {
            if (!visibleChannels.has(meta.key)) return null;

            // Get the channel config
            const channelConfig = channelOverrides?.[meta.key] ?? family[meta.key];
            const path = generatePath(channelConfig, steps, meta);

            // Check if there's a preview curve for this channel
            const previewCurve = previewCurves?.[meta.key];
            let previewPath: string | null = null;
            if (previewCurve) {
              // Create a modified channel config with the preview curve
              const previewConfig: ChannelConfig = {
                ...channelConfig,
                curve: previewCurve,
              };
              previewPath = generatePath(previewConfig, steps, meta);
            }

            const isDraggingCurve = dragging?.type === "curve" && dragging?.channel === meta.key;
            const isHoveringCurveThis = hoveringCurve === meta.key;

            return (
              <g key={meta.key}>
                {/* Preview curve line (shown when hovering over dropdown) */}
                {previewPath && (
                  <path
                    d={previewPath}
                    fill="none"
                    stroke="#fbbf24"
                    strokeWidth="0.6"
                    strokeOpacity="1"
                    vectorEffect="non-scaling-stroke"
                    style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.5))" }}
                  />
                )}
                {/* Current curve line */}
                <path
                  d={path}
                  fill="none"
                  stroke="white"
                  strokeWidth="0.4"
                  strokeOpacity={previewPath ? 0.4 : (isDraggingCurve || isHoveringCurveThis) ? 1 : 0.9}
                  vectorEffect="non-scaling-stroke"
                  style={{
                    filter: (isDraggingCurve || isHoveringCurveThis)
                      ? "drop-shadow(0 0 4px rgba(255,255,255,0.6)) drop-shadow(0 1px 2px rgba(0,0,0,0.3))"
                      : "drop-shadow(0 1px 2px rgba(0,0,0,0.3))"
                  }}
                />
                {/* Invisible wider hitbox for curve dragging */}
                {onOffsetChannel && (
                  <path
                    d={path}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="8"
                    vectorEffect="non-scaling-stroke"
                    style={{
                      cursor: isDraggingCurve ? "grabbing" : "grab",
                      pointerEvents: "auto",
                    }}
                    onPointerEnter={() => setHoveringCurve(meta.key)}
                    onPointerLeave={() => setHoveringCurve(null)}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragging({
                        channel: meta.key,
                        index: -1, // -1 indicates curve drag, not point
                        type: "curve",
                        startY: e.clientY,
                      });
                      (e.target as SVGElement).setPointerCapture(e.pointerId);
                    }}
                  />
                )}
              </g>
            );
          })}
        </svg>

        {/* Points layer - simplified for spline-based curves */}
        <div className="absolute inset-0 pointer-events-none">
          {CHANNELS.map((meta) => {
            if (!visibleChannels.has(meta.key)) return null;

            const values = channelValues[meta.key];
            const n = values.length;

            return values.map((v, i) => {
              const x = getXPosition(i, n);
              const y = yScale(v.value, meta);
              const isFirst = i === 0;
              const isLast = i === n - 1;
              const isEndpoint = isFirst || isLast;
              const isActiveAnchor = v.isOverride || isEndpoint;
              const isDraggingThis = dragging?.channel === meta.key && dragging?.index === i;
              const isHoveringThis = hovering?.channel === meta.key && hovering?.index === i;
              const isHighlighted = isDraggingThis || isHoveringThis;

              // Get background color luminance for contrast-aware label colors
              const bgLuminance = isFirst
                ? colorMetrics[0]?.luminance ?? 0.5
                : isLast
                ? colorMetrics[colorMetrics.length - 1]?.luminance ?? 0.5
                : 0.5;
              const labelColor = bgLuminance > 0.5 ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.8)";

              return (
                <div key={`${meta.key}-${i}`}>
                  {/* Channel label at first node (left side) */}
                  {isFirst && (
                    <div
                      className="absolute text-[10px] font-bold pointer-events-none"
                      style={{
                        left: `${x}%`,
                        top: `${y}%`,
                        transform: "translate(-280%, -50%)",
                        color: labelColor,
                        textShadow: bgLuminance > 0.5
                          ? "0 1px 2px rgba(255,255,255,0.3)"
                          : "0 1px 2px rgba(0,0,0,0.5)",
                      }}
                    >
                      {meta.shortLabel}
                    </div>
                  )}

                  {/* Channel label at last node (right side) */}
                  {isLast && (
                    <div
                      className="absolute text-[10px] font-bold pointer-events-none"
                      style={{
                        left: `${x}%`,
                        top: `${y}%`,
                        transform: "translate(180%, -50%)",
                        color: labelColor,
                        textShadow: bgLuminance > 0.5
                          ? "0 1px 2px rgba(255,255,255,0.3)"
                          : "0 1px 2px rgba(0,0,0,0.5)",
                      }}
                    >
                      {meta.shortLabel}
                    </div>
                  )}

                  {/* Anchor point */}
                  <div
                    className={cn(
                      "absolute rounded-full cursor-grab transition-transform pointer-events-auto",
                      "border-2 border-white",
                      // Active anchors (endpoints + overrides) are solid, others are hollow
                      isActiveAnchor
                        ? "bg-white"
                        : "bg-transparent opacity-60",
                      // Size based on type
                      isActiveAnchor ? "w-3.5 h-3.5" : "w-2.5 h-2.5",
                      // Highlight on hover/drag
                      isHighlighted && "scale-150",
                      isDraggingThis && "cursor-grabbing"
                    )}
                    style={{
                      left: `${x}%`,
                      top: `${y}%`,
                      transform: "translate(-50%, -50%)",
                      boxShadow: isActiveAnchor
                        ? "0 2px 4px rgba(0,0,0,0.4)"
                        : "0 1px 2px rgba(0,0,0,0.2)",
                      zIndex: isHighlighted ? 20 : 15,
                    }}
                    onPointerDown={(e) => handlePointerDown(e, meta.key, i, "point")}
                    onPointerEnter={() => setHovering({ channel: meta.key, index: i })}
                    onPointerLeave={() => setHovering(null)}
                    onDoubleClick={() => handleDoubleClick(meta.key, i)}
                  />
                </div>
              );
            });
          })}
        </div>

        {/* Tooltip for hovered/dragged point (not for curve dragging) */}
        {(hovering || (dragging && dragging.type === "point")) && (
          <div
            className="absolute pointer-events-none z-20"
            style={{
              left: `${getXPosition((hovering || dragging)!.index, steps.length)}%`,
              top: `${yScale(
                channelValues[(hovering || dragging)!.channel][(hovering || dragging)!.index].value,
                CHANNELS.find((c) => c.key === (hovering || dragging)!.channel)!
              )}%`,
              transform: "translate(-50%, -130%)",
            }}
          >
            <div className="bg-black/90 text-white text-xs px-2 py-1 rounded font-mono whitespace-nowrap shadow-lg">
              {(() => {
                const active = hovering || dragging;
                const meta = CHANNELS.find((c) => c.key === active!.channel)!;
                const value = channelValues[active!.channel][active!.index].value;
                const formattedValue = meta.isHue
                  ? `${Math.round(value)}°`
                  : value.toFixed(2);
                return `${meta.shortLabel}: ${formattedValue}`;
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Y-axis labels */}
      <div className="absolute left-0 flex flex-col justify-between text-[9px] font-mono text-zinc-400" style={{ top: 50, bottom: 40, width: 20 }}>
        {CHANNELS.filter((m) => visibleChannels.has(m.key)).map((meta, idx) => (
          <div key={meta.key} className="flex flex-col justify-between h-full" style={{ marginLeft: -20 - idx * 20 }}>
            <span>{meta.shortLabel}</span>
          </div>
        ))}
      </div>

      {/* Bottom step names */}
      <div className="absolute left-0 right-0 bottom-0 h-10 flex">
        {steps.map((step, i) => (
          <div
            key={step}
            className="flex-1 flex items-center justify-center text-[10px] font-mono text-zinc-500"
          >
            {step}
          </div>
        ))}
      </div>
    </div>
  );
}
