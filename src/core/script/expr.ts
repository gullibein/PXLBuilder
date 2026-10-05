/**
 * The expression language of behavior scripts: arithmetic, comparisons,
 * logic, conditionals, variables, entity properties and a fixed set of
 * functions. Expressions are text ("dist(player) < 160 and grounded") parsed
 * into a small tree by this hand-written parser; nothing is ever evaluated as
 * JavaScript. The checker rejects unknown names before a script is accepted.
 */

export type Expr =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'null' }
  | { k: 'id'; name: string }
  | { k: 'mem'; obj: Expr; name: string }
  | { k: 'call'; fn: string; args: Expr[] }
  | { k: 'un'; op: '-' | '!'; a: Expr }
  | { k: 'bin'; op: BinOp; a: Expr; b: Expr }
  | { k: 'cond'; c: Expr; a: Expr; b: Expr };

export type BinOp = '+' | '-' | '*' | '/' | '%' | '<' | '<=' | '>' | '>=' | '==' | '!=' | '&&' | '||';

export class ExprError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExprError';
  }
}

type Tok = { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'id'; v: string } | { t: 'op'; v: string } | { t: 'end' };

const OPS = ['<=', '>=', '==', '!=', '&&', '||', '+', '-', '*', '/', '%', '<', '>', '!', '(', ')', ',', '.', '?', ':'];
const MAX_LENGTH = 500;

function tokenize(src: string): Tok[] {
  if (src.length > MAX_LENGTH) throw new ExprError(`is too long (max ${MAX_LENGTH} characters)`);
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^[0-9]*\.?[0-9]+(e[+-]?[0-9]+)?|^[0-9]+\.?/i.exec(src.slice(i))!;
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = src.indexOf(ch, i + 1);
      if (end < 0) throw new ExprError('has a text that is never closed');
      out.push({ t: 'str', v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: 'id', v: m[0] });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`has an unexpected character "${ch}"`);
    out.push({ t: 'op', v: op });
    i += op.length;
  }
  out.push({ t: 'end' });
  return out;
}

const WORD_OPS: Record<string, string> = { and: '&&', or: '||', not: '!' };

/** Parses an expression; throws ExprError with a readable message. */
export function parseExpr(src: string): Expr {
  if (typeof src !== 'string' || !src.trim()) throw new ExprError('is empty');
  const toks = tokenize(src).map((t) => (t.t === 'id' && WORD_OPS[t.v] ? ({ t: 'op', v: WORD_OPS[t.v] } as Tok) : t));
  let pos = 0;
  const peek = () => toks[pos];
  const isOp = (v: string) => peek().t === 'op' && (peek() as { v: string }).v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new ExprError(`expected "${v}"${describeTok(peek())}`);
    pos++;
  };

  const ternary = (): Expr => {
    const c = binary(0);
    if (!isOp('?')) return c;
    pos++;
    const a = ternary();
    expect(':');
    const b = ternary();
    return { k: 'cond', c, a, b };
  };
  const LEVELS: BinOp[][] = [['||'], ['&&'], ['==', '!='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']];
  const binary = (level: number): Expr => {
    if (level >= LEVELS.length) return unary();
    let a = binary(level + 1);
    for (;;) {
      const t = peek();
      if (t.t !== 'op' || !LEVELS[level].includes(t.v as BinOp)) return a;
      pos++;
      a = { k: 'bin', op: t.v as BinOp, a, b: binary(level + 1) };
    }
  };
  const unary = (): Expr => {
    if (isOp('-') || isOp('!')) {
      const op = (toks[pos++] as { v: string }).v as '-' | '!';
      return { k: 'un', op, a: unary() };
    }
    return postfix();
  };
  const postfix = (): Expr => {
    let e = primary();
    while (isOp('.')) {
      pos++;
      const t = peek();
      if (t.t !== 'id') throw new ExprError(`expected a property name after "."${describeTok(t)}`);
      pos++;
      e = { k: 'mem', obj: e, name: t.v };
    }
    return e;
  };
  const primary = (): Expr => {
    const t = toks[pos++];
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'id') {
      if (t.v === 'true' || t.v === 'false') return { k: 'bool', v: t.v === 'true' };
      if (t.v === 'null') return { k: 'null' };
      if (isOp('(')) {
        pos++;
        const args: Expr[] = [];
        if (!isOp(')')) {
          for (;;) {
            args.push(ternary());
            if (isOp(',')) pos++;
            else break;
          }
        }
        expect(')');
        return { k: 'call', fn: t.v, args };
      }
      return { k: 'id', name: t.v };
    }
    if (t.t === 'op' && t.v === '(') {
      const e = ternary();
      expect(')');
      return e;
    }
    pos--;
    throw new ExprError(`expected a value${describeTok(t)}`);
  };

  const e = ternary();
  if (peek().t !== 'end') throw new ExprError(`has something unexpected${describeTok(peek())}`);
  return e;
}

function describeTok(t: Tok): string {
  if (t.t === 'end') return ' but it ends there';
  return ` at "${'v' in t ? t.v : ''}"`;
}

/** Names an expression may use, for the checker. */
export interface Scope {
  /** Plain names: script variables and built-ins (self, player, time…). */
  names: Set<string>;
  /** Functions and how many arguments each takes. */
  functions: Record<string, { min: number; max: number }>;
  /** Properties that can follow "." */
  members: Set<string>;
}

/** Returns the first problem with the expression's names, or null. */
export function checkExpr(e: Expr, scope: Scope): string | null {
  switch (e.k) {
    case 'id':
      return scope.names.has(e.name) ? null : `unknown name "${e.name}"${suggest(e.name, [...scope.names])}`;
    case 'mem':
      return checkExpr(e.obj, scope) ?? (scope.members.has(e.name) ? null : `unknown property ".${e.name}"${suggest(e.name, [...scope.members])}`);
    case 'call': {
      const f = scope.functions[e.fn];
      if (!f) return `unknown function "${e.fn}"${suggest(e.fn, Object.keys(scope.functions))}`;
      if (e.args.length < f.min || e.args.length > f.max) return `${e.fn}() takes ${f.min === f.max ? f.min : `${f.min} to ${f.max}`} argument${f.max === 1 ? '' : 's'}, not ${e.args.length}`;
      for (const a of e.args) {
        const err = checkExpr(a, scope);
        if (err) return err;
      }
      return null;
    }
    case 'un':
      return checkExpr(e.a, scope);
    case 'bin':
      return checkExpr(e.a, scope) ?? checkExpr(e.b, scope);
    case 'cond':
      return checkExpr(e.c, scope) ?? checkExpr(e.a, scope) ?? checkExpr(e.b, scope);
    default:
      return null;
  }
}

/** " (did you mean …?)" for a near miss. */
export function suggest(name: string, options: string[]): string {
  let best = '';
  let bestD = 3;
  for (const o of options) {
    const d = editDistance(name.toLowerCase(), o.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best ? ` (did you mean "${best}"?)` : '';
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return dp[a.length][b.length];
}

/** Back to text (for showing scripts). */
export function formatExpr(e: Expr): string {
  switch (e.k) {
    case 'num':
      return String(e.v);
    case 'str':
      return JSON.stringify(e.v);
    case 'bool':
      return String(e.v);
    case 'null':
      return 'null';
    case 'id':
      return e.name;
    case 'mem':
      return `${formatExpr(e.obj)}.${e.name}`;
    case 'call':
      return `${e.fn}(${e.args.map(formatExpr).join(', ')})`;
    case 'un':
      return `${e.op === '!' ? 'not ' : '-'}${formatExpr(e.a)}`;
    case 'bin':
      return `(${formatExpr(e.a)} ${e.op === '&&' ? 'and' : e.op === '||' ? 'or' : e.op} ${formatExpr(e.b)})`;
    case 'cond':
      return `(${formatExpr(e.c)} ? ${formatExpr(e.a)} : ${formatExpr(e.b)})`;
  }
}
