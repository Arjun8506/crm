// A small, safe expression language for workflow conditions and computed values.
//
//   IF({stage} = "won" && {value} >= 10000, "Big win", "Keep going")
//   DATEDIFF({close_date}, TODAY(), "days") < 7
//   CONCAT({name}, " (", {company.name}, ")")  -- {a.b} reads nested values
//
// It is parsed into an AST and interpreted. There is no eval, no new Function, no property access beyond the
// supplied context, and hard limits on size, nesting and evaluation steps, so user input cannot run code or loop forever.

export class FormulaError extends Error {
  constructor(message, position) {
    super(position === undefined ? message : `${message} (at character ${position + 1})`);
    this.position = position;
  }
}

const MAX_LENGTH = 1000;
const MAX_TOKENS = 500;
const MAX_DEPTH = 30;
const MAX_STEPS = 5000;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

// ---------- tokenizer ----------
function tokenize(src) {
  const tokens = [];
  let i = 0;
  const push = (type, value, pos) => {
    if (tokens.length >= MAX_TOKENS) throw new FormulaError('Formula is too long', pos);
    tokens.push({ type, value, pos });
  };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      push('num', Number(m[0]), i);
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      let out = ''; let j = i + 1; let closed = false;
      while (j < src.length) {
        if (src[j] === '\\' && j + 1 < src.length) { out += { n: '\n', t: '\t' }[src[j + 1]] ?? src[j + 1]; j += 2; continue; }
        if (src[j] === c) { closed = true; break; }
        out += src[j++];
      }
      if (!closed) throw new FormulaError('Unterminated text', i);
      push('str', out, i);
      i = j + 1;
      continue;
    }
    if (c === '{') {
      const end = src.indexOf('}', i);
      const path = end < 0 ? '' : src.slice(i + 1, end).trim();
      if (end < 0 || !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(path)) throw new FormulaError('Invalid field reference, expected {field_key}', i);
      push('ref', path.split('.'), i);
      i = end + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      push('id', m[0], i);
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['&&', '||', '==', '!=', '<>', '<=', '>='].includes(two)) { push('op', two, i); i += 2; continue; }
    if ('+-*/%&<>=!(),'.includes(c)) { push('op', c, i); i++; continue; }
    throw new FormulaError(`Unexpected character "${c}"`, i);
  }
  return tokens;
}

// ---------- parser (recursive descent) ----------
export function parse(src) {
  if (typeof src !== 'string' || !src.trim()) throw new FormulaError('Enter a formula');
  if (src.length > MAX_LENGTH) throw new FormulaError(`Formula is too long (max ${MAX_LENGTH} characters)`);
  const tokens = tokenize(src);
  let p = 0;
  let depth = 0;
  const peek = () => tokens[p];
  const isOp = (v) => peek()?.type === 'op' && peek().value === v;
  const nest = (fn) => {
    if (++depth > MAX_DEPTH) throw new FormulaError('Formula is nested too deeply', peek()?.pos);
    const r = fn();
    depth--;
    return r;
  };

  function binary(next, ops) {
    let left = next();
    while (peek()?.type === 'op' && ops.includes(peek().value)) {
      const op = tokens[p++].value;
      left = { t: 'bin', op, l: left, r: next() };
    }
    return left;
  }
  const or = () => binary(and, ['||']);
  const and = () => binary(cmp, ['&&']);
  function cmp() {
    const left = concat();
    if (peek()?.type === 'op' && ['=', '==', '!=', '<>', '<', '<=', '>', '>='].includes(peek().value)) {
      const op = tokens[p++].value;
      return { t: 'bin', op, l: left, r: concat() };
    }
    return left;
  }
  const concat = () => binary(add, ['&']);
  const add = () => binary(mul, ['+', '-']);
  const mul = () => binary(unary, ['*', '/', '%']);
  function unary() {
    if (peek()?.type === 'op' && ['-', '!', '+'].includes(peek().value)) {
      const op = tokens[p++].value;
      return { t: 'un', op, e: nest(unary) };
    }
    return primary();
  }
  function primary() {
    const tok = tokens[p++];
    if (!tok) throw new FormulaError('The formula ends unexpectedly');
    if (tok.type === 'num' || tok.type === 'str') return { t: 'lit', v: tok.value };
    if (tok.type === 'ref') return { t: 'ref', path: tok.value };
    if (tok.type === 'id') {
      const lower = tok.value.toLowerCase();
      if (!isOp('(')) {
        if (lower === 'true') return { t: 'lit', v: true };
        if (lower === 'false') return { t: 'lit', v: false };
        if (lower === 'null') return { t: 'lit', v: null };
        throw new FormulaError(`Unknown word "${tok.value}". Use {field_key} for fields and quotes for text`, tok.pos);
      }
      p++; // (
      const name = tok.value.toUpperCase();
      if (!FUNCTIONS[name]) throw new FormulaError(`Unknown function ${tok.value}`, tok.pos);
      const args = [];
      if (!isOp(')')) {
        do { args.push(nest(or)); } while (isOp(',') && ++p);
      }
      if (!isOp(')')) throw new FormulaError('Missing closing )', peek()?.pos ?? src.length - 1);
      p++;
      const [min, max] = FUNCTIONS[name].arity;
      if (args.length < min || args.length > max) throw new FormulaError(`${name} takes ${min === max ? min : `${min} to ${max === Infinity ? 'any number of' : max}`} argument${max === 1 ? '' : 's'}`, tok.pos);
      return { t: 'call', name, args };
    }
    if (tok.type === 'op' && tok.value === '(') {
      const e = nest(or);
      if (!isOp(')')) throw new FormulaError('Missing closing )', peek()?.pos ?? src.length - 1);
      p++;
      return e;
    }
    throw new FormulaError(`Unexpected "${tok.value}"`, tok.pos);
  }

  const ast = nest(or);
  if (p < tokens.length) throw new FormulaError(`Unexpected "${tokens[p].value}"`, tokens[p].pos);
  return ast;
}

// ---------- values ----------
const isEmpty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
const toNumber = (v, what = 'a number') => {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.getTime();
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) throw new FormulaError(`Expected ${what} but got "${String(v).slice(0, 30)}"`);
  return n;
};
const toText = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};
const truthy = (v) => (typeof v === 'string' ? v !== '' && v.toLowerCase() !== 'false' : !!v && !(Array.isArray(v) && v.length === 0));
const toDate = (v) => {
  if (v instanceof Date) return v;
  if (typeof v === 'string' || typeof v === 'number') { const d = new Date(v); if (!Number.isNaN(d.getTime())) return d; }
  throw new FormulaError(`"${toText(v).slice(0, 30)}" is not a date`);
};
const equal = (a, b) => {
  if (isEmpty(a) && isEmpty(b)) return true;
  if (a instanceof Date || b instanceof Date) { try { return toDate(a).getTime() === toDate(b).getTime(); } catch { return false; } }
  if (typeof a === 'number' || typeof b === 'number') return a === b || (Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && !isEmpty(a) && !isEmpty(b) && Number(a) === Number(b));
  return a === b;
};
const compare = (a, b) => {
  if (a instanceof Date || b instanceof Date) return toDate(a).getTime() - toDate(b).getTime();
  if (typeof a === 'string' && typeof b === 'string' && (Number.isNaN(Number(a)) || Number.isNaN(Number(b)))) return a < b ? -1 : a > b ? 1 : 0;
  return toNumber(a) - toNumber(b);
};

const FUNCTIONS = {
  IF: { arity: [3, 3], lazy: true },
  AND: { arity: [1, Infinity], fn: (...a) => a.every(truthy) },
  OR: { arity: [1, Infinity], fn: (...a) => a.some(truthy) },
  NOT: { arity: [1, 1], fn: (a) => !truthy(a) },
  ISEMPTY: { arity: [1, 1], fn: isEmpty },
  COALESCE: { arity: [1, Infinity], fn: (...a) => a.find((v) => !isEmpty(v)) ?? null },
  IN: { arity: [2, Infinity], fn: (x, ...rest) => rest.some((r) => equal(x, r)) },
  CONCAT: { arity: [1, Infinity], fn: (...a) => a.map(toText).join('') },
  LEN: { arity: [1, 1], fn: (a) => (Array.isArray(a) ? a.length : toText(a).length) },
  LOWER: { arity: [1, 1], fn: (a) => toText(a).toLowerCase() },
  UPPER: { arity: [1, 1], fn: (a) => toText(a).toUpperCase() },
  TRIM: { arity: [1, 1], fn: (a) => toText(a).trim() },
  CONTAINS: { arity: [2, 2], fn: (a, b) => (Array.isArray(a) ? a.some((x) => equal(x, b)) : toText(a).toLowerCase().includes(toText(b).toLowerCase())) },
  STARTSWITH: { arity: [2, 2], fn: (a, b) => toText(a).toLowerCase().startsWith(toText(b).toLowerCase()) },
  ROUND: { arity: [1, 2], fn: (n, d = 0) => { const f = 10 ** Math.max(0, Math.min(10, toNumber(d))); return Math.round(toNumber(n) * f) / f; } },
  FLOOR: { arity: [1, 1], fn: (n) => Math.floor(toNumber(n)) },
  CEIL: { arity: [1, 1], fn: (n) => Math.ceil(toNumber(n)) },
  ABS: { arity: [1, 1], fn: (n) => Math.abs(toNumber(n)) },
  MIN: { arity: [1, Infinity], fn: (...a) => Math.min(...a.map((x) => toNumber(x))) },
  MAX: { arity: [1, Infinity], fn: (...a) => Math.max(...a.map((x) => toNumber(x))) },
  SUM: { arity: [1, Infinity], fn: (...a) => a.reduce((n, x) => n + toNumber(x), 0) },
  NUMBER: { arity: [1, 1], fn: (a) => toNumber(a) },
  TEXT: { arity: [1, 1], fn: toText },
  NOW: { arity: [0, 0], needsCtx: true, fn: (ctx) => ctx.now },
  TODAY: { arity: [0, 0], needsCtx: true, fn: (ctx) => { const d = new Date(ctx.now); d.setUTCHours(0, 0, 0, 0); return d; } },
  DATE: { arity: [1, 1], fn: toDate },
  ADDDAYS: { arity: [2, 2], fn: (d, n) => new Date(toDate(d).getTime() + toNumber(n) * 864e5) },
  DATEDIFF: {
    arity: [2, 3],
    fn: (a, b, unit = 'days') => {
      const ms = toDate(a).getTime() - toDate(b).getTime();
      const div = { days: 864e5, hours: 36e5, minutes: 6e4 }[String(unit).toLowerCase()];
      if (!div) throw new FormulaError('DATEDIFF unit must be "days", "hours" or "minutes"');
      return Math.trunc(ms / div);
    },
  },
  ISCHANGED: { arity: [1, 1], special: true },
};

// ---------- evaluation ----------
function lookup(path, ctx) {
  let cur = ctx.values;
  for (const key of path) {
    if (FORBIDDEN_KEYS.has(key) || cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, key)) return null;
    cur = cur[key];
  }
  return cur === undefined ? null : cur;
}

function run(node, ctx) {
  if (++ctx.steps > MAX_STEPS) throw new FormulaError('Formula is too complex to evaluate');
  switch (node.t) {
    case 'lit': return node.v;
    case 'ref': return lookup(node.path, ctx);
    case 'un': {
      const v = run(node.e, ctx);
      return node.op === '!' ? !truthy(v) : node.op === '-' ? -toNumber(v) : toNumber(v);
    }
    case 'bin': {
      if (node.op === '&&') return truthy(run(node.l, ctx)) && truthy(run(node.r, ctx));
      if (node.op === '||') return truthy(run(node.l, ctx)) || truthy(run(node.r, ctx));
      const a = run(node.l, ctx); const b = run(node.r, ctx);
      switch (node.op) {
        case '+': return toNumber(a) + toNumber(b);
        case '-': return toNumber(a) - toNumber(b);
        case '*': return toNumber(a) * toNumber(b);
        case '/': { const d = toNumber(b); if (d === 0) throw new FormulaError('Division by zero'); return toNumber(a) / d; }
        case '%': { const d = toNumber(b); if (d === 0) throw new FormulaError('Division by zero'); return toNumber(a) % d; }
        case '&': return toText(a) + toText(b);
        case '=': case '==': return equal(a, b);
        case '!=': case '<>': return !equal(a, b);
        case '<': return compare(a, b) < 0;
        case '<=': return compare(a, b) <= 0;
        case '>': return compare(a, b) > 0;
        default: return compare(a, b) >= 0;
      }
    }
    default: { // call
      const def = FUNCTIONS[node.name];
      if (node.name === 'IF') return truthy(run(node.args[0], ctx)) ? run(node.args[1], ctx) : run(node.args[2], ctx);
      if (def.special) return ctx.changed.has(toText(run(node.args[0], ctx)));
      if (def.needsCtx) return def.fn(ctx);
      return def.fn(...node.args.map((a) => run(a, ctx)));
    }
  }
}

// context: { values: {...field values}, changed?: Set<string>, now?: Date }
export function evaluate(ast, context = {}) {
  const ctx = { values: context.values ?? {}, changed: context.changed ?? new Set(), now: context.now ?? new Date(), steps: 0 };
  const out = run(ast, ctx);
  return out instanceof Date && Number.isNaN(out.getTime()) ? null : out;
}

export const evaluateExpression = (expression, context) => evaluate(parse(expression), context);
export const isTruthy = truthy;

// Fields referenced by a formula, for validation and the UI.
export function referencedFields(ast, out = new Set()) {
  if (ast.t === 'ref') out.add(ast.path[0]);
  for (const k of ['l', 'r', 'e']) if (ast[k]) referencedFields(ast[k], out);
  for (const a of ast.args ?? []) referencedFields(a, out);
  return out;
}

// ---------- templates: "Hello {{name}}" ----------
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderTemplate(template, values, { html = false } = {}) {
  return String(template ?? '').replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\}\}/g, (_m, path) => {
    const text = toText(lookup(path.split('.'), { values }));
    return html ? escapeHtml(text) : text;
  });
}
