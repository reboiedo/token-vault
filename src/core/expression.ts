/**
 * Expression evaluator for dimension/number token values.
 *
 * An expression is a small arithmetic formula over token references:
 *   `container * 0.875`
 *   `gap-m + spacing-s`
 *   `(viewport-max - viewport-min) / 4`
 *
 * Identifiers ARE token references (dotted names) — token-vault's
 * identity model. Renames rewrite the formula text via
 * `renameIdentifierInFormula` (the store's rewriteRefs cascade).
 *
 * Grammar (recursive descent, all left-associative):
 *   expr     := term (('+' | '-') term)*
 *   term     := factor (('*' | '/') factor)*
 *   factor   := '-' factor | primary
 *   primary  := NUMBER | IDENT | '(' expr ')'
 *
 * Numbers are bare (no units — the unit is decided by the consumer when
 * emitting). Identifiers match `[A-Za-z_][\w-]*` (token name chars).
 */

import type { TokenRef } from "./types";

export type ExprNode =
  | { kind: "num"; value: number }
  | { kind: "ident"; name: string }
  | { kind: "neg"; arg: ExprNode }
  | { kind: "binop"; op: "+" | "-" | "*" | "/"; left: ExprNode; right: ExprNode };

export interface ParsedExpression {
  ast: ExprNode;
  /** Distinct identifier names referenced. Order of first appearance. */
  identifiers: string[];
}

export class ExpressionError extends Error {}

// ============================================================================
// PARSER
// ============================================================================

type Tok =
  | { t: "num"; v: number; at: number }
  | { t: "ident"; v: string; at: number }
  | { t: "op"; v: "+" | "-" | "*" | "/"; at: number }
  | { t: "lp" | "rp"; at: number }
  | { t: "eof"; at: number };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n") {
      i++;
      continue;
    }
    if (c === "(" || c === ")") {
      out.push({ t: c === "(" ? "lp" : "rp", at: i });
      i++;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/") {
      out.push({ t: "op", v: c, at: i });
      i++;
      continue;
    }
    // number — supports leading . and decimals; sign handled by unary.
    if ((c >= "0" && c <= "9") || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const start = i;
      while (i < src.length && /[0-9.]/.test(src[i])) i++;
      const raw = src.slice(start, i);
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        throw new ExpressionError(`Bad number "${raw}" at ${start}`);
      }
      out.push({ t: "num", v: n, at: start });
      continue;
    }
    // identifier — token names can contain letters, digits, "-", "_", ".".
    // Must start with letter or "_".
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < src.length && /[A-Za-z0-9_\-.]/.test(src[i])) i++;
      out.push({ t: "ident", v: src.slice(start, i), at: start });
      continue;
    }
    throw new ExpressionError(`Unexpected character "${c}" at ${i}`);
  }
  out.push({ t: "eof", at: src.length });
  return out;
}

class Parser {
  private pos = 0;
  constructor(private readonly toks: Tok[]) {}
  private peek(): Tok {
    return this.toks[this.pos];
  }
  private consume(): Tok {
    return this.toks[this.pos++];
  }
  parse(): ExprNode {
    const node = this.parseExpr();
    if (this.peek().t !== "eof") {
      throw new ExpressionError(
        `Unexpected token "${(this.peek() as { v?: unknown }).v ?? this.peek().t}" at ${this.peek().at}`
      );
    }
    return node;
  }
  private parseExpr(): ExprNode {
    let left = this.parseTerm();
    while (this.peek().t === "op" && ((this.peek() as { v: string }).v === "+" || (this.peek() as { v: string }).v === "-")) {
      const op = (this.consume() as { v: "+" | "-" }).v;
      const right = this.parseTerm();
      left = { kind: "binop", op, left, right };
    }
    return left;
  }
  private parseTerm(): ExprNode {
    let left = this.parseFactor();
    while (this.peek().t === "op" && ((this.peek() as { v: string }).v === "*" || (this.peek() as { v: string }).v === "/")) {
      const op = (this.consume() as { v: "*" | "/" }).v;
      const right = this.parseFactor();
      left = { kind: "binop", op, left, right };
    }
    return left;
  }
  private parseFactor(): ExprNode {
    if (this.peek().t === "op" && (this.peek() as { v: string }).v === "-") {
      this.consume();
      return { kind: "neg", arg: this.parseFactor() };
    }
    if (this.peek().t === "op" && (this.peek() as { v: string }).v === "+") {
      this.consume();
      return this.parseFactor();
    }
    return this.parsePrimary();
  }
  private parsePrimary(): ExprNode {
    const t = this.peek();
    if (t.t === "num") {
      this.consume();
      return { kind: "num", value: t.v };
    }
    if (t.t === "ident") {
      this.consume();
      return { kind: "ident", name: t.v };
    }
    if (t.t === "lp") {
      this.consume();
      const node = this.parseExpr();
      const close = this.consume();
      if (close.t !== "rp") {
        throw new ExpressionError(`Expected ')' at ${close.at}`);
      }
      return node;
    }
    throw new ExpressionError(`Unexpected token at ${t.at}`);
  }
}

export function parseExpression(formula: string): ParsedExpression {
  const ast = new Parser(tokenize(formula)).parse();
  const seen = new Set<string>();
  const identifiers: string[] = [];
  (function walk(n: ExprNode) {
    if (n.kind === "ident") {
      if (!seen.has(n.name)) {
        seen.add(n.name);
        identifiers.push(n.name);
      }
    } else if (n.kind === "binop") {
      walk(n.left);
      walk(n.right);
    } else if (n.kind === "neg") {
      walk(n.arg);
    }
  })(ast);
  return { ast, identifiers };
}

// ============================================================================
// EVALUATION
// ============================================================================

/**
 * Evaluate an AST to a number. `resolveIdent` returns the numeric value of
 * an identifier (in pixels — callers normalize before passing in).
 * Returns null if any identifier is unresolved.
 */
export function evaluateExpression(
  ast: ExprNode,
  resolveIdent: (name: string) => number | null
): number | null {
  switch (ast.kind) {
    case "num":
      return ast.value;
    case "ident": {
      const v = resolveIdent(ast.name);
      return v;
    }
    case "neg": {
      const v = evaluateExpression(ast.arg, resolveIdent);
      return v === null ? null : -v;
    }
    case "binop": {
      const l = evaluateExpression(ast.left, resolveIdent);
      if (l === null) return null;
      const r = evaluateExpression(ast.right, resolveIdent);
      if (r === null) return null;
      switch (ast.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          if (r === 0) return null;
          return l / r;
      }
    }
  }
}

// ============================================================================
// CSS EMISSION
// ============================================================================

/**
 * Emit a CSS `calc(...)` expression from the AST. Identifiers become
 * `var(--prefix-tokenName)` via `cssVarFor`. Numbers stay bare (the unit
 * gets attached by the caller wrapping the result, since DTCG dimension
 * tokens emit unit-prefixed values).
 *
 * Wraps the whole thing in `calc()` only when there's at least one binop;
 * pure-number or pure-identifier expressions don't need it.
 */
export function emitCssExpression(
  ast: ExprNode,
  cssVarFor: (name: string) => string
): string {
  const inner = renderInner(ast, cssVarFor);
  if (ast.kind === "binop" || ast.kind === "neg") {
    return `calc(${inner})`;
  }
  return inner;
}

function renderInner(
  ast: ExprNode,
  cssVarFor: (name: string) => string,
  parentPrec = 0
): string {
  switch (ast.kind) {
    case "num":
      return String(ast.value);
    case "ident":
      return cssVarFor(ast.name);
    case "neg":
      return `(-1 * ${renderInner(ast.arg, cssVarFor, 3)})`;
    case "binop": {
      const prec = ast.op === "+" || ast.op === "-" ? 1 : 2;
      const expr = `${renderInner(ast.left, cssVarFor, prec)} ${ast.op} ${renderInner(ast.right, cssVarFor, prec)}`;
      return prec < parentPrec ? `(${expr})` : expr;
    }
  }
}

// ============================================================================
// CANONICALIZATION
// ============================================================================

/**
 * Rewrite the formula's identifiers using a name map. Used for renames:
 * when token `old` is renamed to `new`, walk every expression that
 * references it and rewrite. Preserves whitespace and operators.
 */
export function renameIdentifierInFormula(
  formula: string,
  oldName: string,
  newName: string
): string {
  // Token-name-safe regex: identifier characters are [A-Za-z0-9_\-.],
  // boundaries are anything not in that set (or start/end of string).
  // We can't use \b because "-" is not a word char.
  const safe = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^A-Za-z0-9_\\-.])(${safe})(?=[^A-Za-z0-9_\\-.]|$)`, "g");
  return formula.replace(re, (_match, pre) => `${pre}${newName}`);
}

// ============================================================================
// CONVENIENT FULL-CYCLE HELPERS
// ============================================================================

/**
 * Resolve an expression value to a number. Identifiers resolve directly
 * by token name. Returns null when any identifier is unresolvable, the
 * referenced token has no numeric value, or the formula has a syntax
 * error.
 */
export function resolveExpressionToNumber(
  formula: string,
  resolveTokenPx: (ref: TokenRef) => number | null
): number | null {
  let parsed: ParsedExpression;
  try {
    parsed = parseExpression(formula);
  } catch {
    return null;
  }
  return evaluateExpression(parsed.ast, (name) => resolveTokenPx(name));
}
