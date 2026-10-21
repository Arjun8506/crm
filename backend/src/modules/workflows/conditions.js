import { TYPES, parseValue } from '../dataforms/fieldTypes.js';
import { evaluateExpression, isTruthy } from '../formulas/formula.js';

// Evaluates a workflow's condition tree against one record. Field tests use the same operators as the record filters,
// so "Stage is Won" means the same thing in a filter, a report and a workflow.

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isEmptyValue = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

function toComparable(field, v) {
  if (field.type === 'datetime') return new Date(v).getTime();
  if (field.type === 'relationship') return String(v);
  return v;
}

export function matchField(field, operator, expected, actual, now = new Date()) {
  switch (operator) {
    case 'empty': return isEmptyValue(actual);
    case 'notEmpty': return !isEmptyValue(actual);
    case 'isTrue': return actual === true;
    case 'isFalse': return actual !== true;
    case 'inLastDays':
    case 'inNextDays': {
      if (isEmptyValue(actual)) return false;
      const t = field.type === 'date' ? new Date(`${actual}T00:00:00Z`).getTime() : new Date(actual).getTime();
      const days = Number(expected) * 864e5;
      return operator === 'inLastDays' ? t >= now.getTime() - days && t <= now.getTime() : t >= now.getTime() && t <= now.getTime() + days;
    }
    default: break;
  }
  const parse = (v) => parseValue({ ...field, min: null, max: null, required: false }, v);
  const group = TYPES[field.type].group;
  const empty = isEmptyValue(actual);

  if (operator === 'contains' || operator === 'notContains') {
    let hit;
    if (group === 'multi') {
      // Each wanted value is a single option, so it is checked like a dropdown value.
      const wanted = [].concat(expected ?? []).map((v) => parseValue({ ...field, type: 'dropdown', min: null, max: null, required: false }, v));
      hit = !empty && wanted.some((w) => actual.includes(w));
    }
    else hit = !empty && String(actual).toLowerCase().includes(String(parse(expected)).toLowerCase());
    return operator === 'contains' ? hit : !hit;
  }
  if (operator === 'startsWith') return !empty && String(actual).toLowerCase().startsWith(String(parse(expected)).toLowerCase());
  if (operator === 'in' || operator === 'notIn') {
    const hit = !empty && [].concat(expected ?? []).map(parse).some((e) => same(toComparable(field, e), toComparable(field, actual)));
    return operator === 'in' ? hit : !hit;
  }
  if (operator === 'between') {
    if (empty || !Array.isArray(expected) || expected.length !== 2) return false;
    const [lo, hi] = expected.map(parse).map((v) => toComparable(field, v));
    const a = toComparable(field, actual);
    return a >= lo && a <= hi;
  }
  const e = toComparable(field, parse(expected));
  const a = empty ? undefined : toComparable(field, actual);
  switch (operator) {
    case 'eq': return !empty && same(a, e);
    case 'ne': return empty || !same(a, e);
    case 'gt': return !empty && a > e;
    case 'gte': return !empty && a >= e;
    case 'lt': return !empty && a < e;
    case 'lte': return !empty && a <= e;
    default: throw new Error(`Unsupported operator: ${operator}`);
  }
}

// ctx: { fields (Map key -> def), current (data being tested), formula (context for formulas) }
export function evaluateTree(node, ctx) {
  if (!node || !node.conditions?.length) return true;
  const results = (function* gen() {
    for (const c of node.conditions) {
      if (c.conditions) yield evaluateTree(c, ctx);
      else if (c.kind === 'formula') yield isTruthy(evaluateExpression(c.expression, ctx.formula));
      else if (c.kind === 'changed') yield ctx.formula.changed.has(c.field);
      else yield matchField(ctx.fields.get(c.field), c.operator, c.value, ctx.current[c.field], ctx.formula.now);
    }
  }());
  return node.op === 'or' ? results.some((r) => r) : [...results].every((r) => r);
}
