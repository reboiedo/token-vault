/**
 * Expression editor — a dimension computed from other tokens. In
 * token-vault the formula's identifiers ARE token names, so there is
 * no ref map: we parse, list the identifiers, and show whether each
 * resolves against the live snapshot.
 */

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { parseExpression, resolveExpressionToNumber } from "@core/expression";
import { useResolver } from "@/lib/resolver";

/** Parse "16px" / "1rem" / bare numbers to px for expression previews. */
export function rawToPx(raw: string | null): number | null {
  if (!raw) return null;
  const m = /^(-?[\d.]+)(px|rem)?$/.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2] === "rem" ? n * 16 : n;
}

export function ExpressionEditor({
  open,
  onOpenChange,
  initialFormula,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialFormula: string;
  onSave: (formula: string) => void | Promise<void>;
}) {
  const [formula, setFormula] = useState(initialFormula);
  const resolver = useResolver();

  const parsed = useMemo(() => {
    try {
      return { ok: true as const, ...parseExpression(formula) };
    } catch (err) {
      return { ok: false as const, error: String((err as Error).message) };
    }
  }, [formula]);

  const previewPx = useMemo(() => {
    if (!parsed.ok) return null;
    return resolveExpressionToNumber(formula, (ref) =>
      rawToPx(resolver.resolveRaw(ref))
    );
  }, [formula, parsed.ok, resolver]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Expression</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={formula}
            onChange={(e) => setFormula(e.target.value)}
            className="font-mono text-sm"
            placeholder="container * 0.75"
            autoFocus
          />
          {!parsed.ok && (
            <p className="text-xs text-red-600">{parsed.error}</p>
          )}
          {parsed.ok && (
            <div className="flex flex-wrap items-center gap-1.5">
              {parsed.identifiers.map((ident) => {
                const resolves = rawToPx(resolver.resolveRaw(ident)) !== null;
                return (
                  <Badge
                    key={ident}
                    variant={resolves ? "secondary" : "destructive"}
                    className="font-mono text-[10px]"
                  >
                    {ident}
                  </Badge>
                );
              })}
              <span className="ml-auto font-mono text-xs text-muted-foreground">
                {previewPx !== null ? `= ${Math.round(previewPx * 100) / 100}px` : "unresolved"}
              </span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!parsed.ok}
            onClick={async () => {
              await onSave(formula);
              onOpenChange(false);
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
