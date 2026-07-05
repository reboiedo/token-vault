/**
 * Expression editor — a dimension computed from other tokens. In
 * token-vault the formula's identifiers ARE token names, so there is
 * no ref map: we parse, list the identifiers, and show whether each
 * resolves against the live snapshot.
 */

import { useEffect, useMemo, useRef, useState } from "react";
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
  const inputRef = useRef<HTMLInputElement>(null);
  const resolver = useResolver();
  // Re-seed when the dialog is reused for another token/mode.
  useEffect(() => setFormula(initialFormula), [initialFormula]);

  // Insertable token names (resolvable to a number), capped like the cloud.
  const available = useMemo(
    () =>
      resolver
        .aliasOptions([])
        .map((o) => o.name)
        .filter((n) => rawToPx(resolver.resolveRaw(n)) !== null)
        .sort()
        .slice(0, 80),
    [resolver]
  );

  const insertAtCursor = (name: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? formula.length;
    const end = el?.selectionEnd ?? formula.length;
    const next = `${formula.slice(0, start)}${name}${formula.slice(end)}`;
    setFormula(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + name.length, start + name.length);
    });
  };

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
            ref={inputRef}
            value={formula}
            onChange={(e) => setFormula(e.target.value)}
            className="font-mono text-sm"
            placeholder="container * 0.75"
            autoFocus
          />
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              Available token names ({available.length})
            </summary>
            <div className="mt-1.5 flex max-h-28 flex-wrap gap-1 overflow-y-auto">
              {available.map((n) => (
                <button
                  key={n}
                  type="button"
                  className="rounded border px-1.5 py-0.5 font-mono text-[10px] transition hover:bg-accent"
                  onClick={() => insertAtCursor(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </details>
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
                {previewPx !== null
                  ? `= ${Math.round(previewPx * 100) / 100}px`
                  : /\/\s*0(?!\d)/.test(formula)
                    ? "divide by zero?"
                    : "unresolved"}
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
