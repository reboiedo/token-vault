/**
 * CollectionHeader — inline header for the active collection, port of
 * the cloud's collection-header.tsx: name + color-coded kind badge,
 * Edit Themes (multi-mode collections), and the multi-type "Add Token"
 * dropdown that creates `untitled-<ts>` with per-type defaults and
 * hands the name back for auto-focus rename in the table, plus the
 * per-collection Tailwind export config popover.
 */

import { useState } from "react";
import { Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EditThemesDialog } from "./edit-themes-dialog";
import { TailwindCollectionConfig } from "./tailwind-collection-config";
import type { CollectionDoc, TokenType, TokenValue } from "@core/types";
import { getEffectiveKind, KIND_BADGE_CLASSES } from "@/lib/collection-kind";
import { useActions } from "@/lib/store";
import { cn } from "@/lib/utils";

/** Per-type default values, mirroring the cloud's Add Token dropdown. */
export function defaultValueFor(type: TokenType): TokenValue {
  switch (type) {
    case "color":
      return { type: "raw", value: "#cccccc" };
    case "dimension":
      return { type: "raw", value: "16px" };
    case "number":
      return { type: "raw", value: 0 };
    case "fontFamily":
      return { type: "raw", value: "Inter" };
    case "fontWeight":
      return { type: "raw", value: 400 };
    case "typography":
      return {
        type: "composite",
        layers: {
          fontFamily: { type: "raw", value: "Inter" },
          fontSize: { type: "raw", value: "16px" },
          fontWeight: { type: "raw", value: 400 },
          letterSpacing: { type: "raw", value: "0px" },
          lineHeight: { type: "raw", value: 1.5 },
        },
      };
    case "duration":
      return { type: "raw", value: "200ms" };
    case "cubicBezier":
      return { type: "raw", value: "0.4, 0, 0.2, 1" };
    case "transition":
      return {
        type: "composite",
        layers: {
          duration: { type: "raw", value: "200ms" },
          delay: { type: "raw", value: "0ms" },
          timingFunction: { type: "raw", value: "0.4, 0, 0.2, 1" },
        },
      };
    case "boolean":
      return { type: "raw", value: true };
    default:
      return { type: "raw", value: "value" };
  }
}

const ADD_TOKEN_GROUPS: TokenType[][] = [
  ["color", "dimension", "number"],
  ["fontFamily", "fontWeight", "typography"],
  ["duration", "cubicBezier", "transition"],
  ["string", "boolean"],
];

const TYPE_LABELS: Partial<Record<TokenType, string>> = {
  fontFamily: "Font Family",
  fontWeight: "Font Weight",
  cubicBezier: "Cubic Bezier",
};

export function CollectionHeader({
  collection,
  onTokenCreated,
}: {
  collection: CollectionDoc;
  onTokenCreated: (name: string) => void;
}) {
  const actions = useActions();
  const [themesOpen, setThemesOpen] = useState(false);
  const kind = getEffectiveKind(collection);
  const multiMode = collection.modes.length > 1 || collection.modes[0] !== "default";

  const addToken = async (type: TokenType) => {
    const name = `untitled-${Date.now()}`;
    const values = Object.fromEntries(
      collection.modes.map((m) => [m, defaultValueFor(type)])
    );
    await actions.createToken({
      collection: collection.name,
      token: { name, type, values },
    });
    onTokenCreated(name);
  };

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="truncate font-semibold">{collection.name}</span>
      <span
        className={cn(
          "rounded px-1.5 py-0.5 text-[10px] font-medium",
          KIND_BADGE_CLASSES[kind]
        )}
      >
        {kind}
      </span>
      <TailwindCollectionConfig collection={collection} />
      {multiMode && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setThemesOpen(true)}
          title="Add, rename, reorder or delete themes"
        >
          <Settings2 className="h-3.5 w-3.5" /> Edit Themes
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button size="sm" className="h-7 text-xs">
              <Plus className="h-3.5 w-3.5" /> Add Token
            </Button>
          }
        />
        <DropdownMenuContent align="start">
          {ADD_TOKEN_GROUPS.map((group, gi) => (
            <div key={gi}>
              {gi > 0 && <DropdownMenuSeparator />}
              {group.map((type) => (
                <DropdownMenuItem
                  key={type}
                  className="text-xs capitalize"
                  onClick={() => void addToken(type)}
                >
                  {TYPE_LABELS[type] ?? type}
                </DropdownMenuItem>
              ))}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {themesOpen && (
        <EditThemesDialog
          open={themesOpen}
          onOpenChange={setThemesOpen}
          collection={collection}
        />
      )}
    </div>
  );
}
