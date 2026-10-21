import { z } from 'zod';
import { badRequest } from '../../utils/errors.js';
import { OPERATORS, TYPES, ValueError, parseValue } from '../dataforms/fieldTypes.js';

// Filter tree sent by clients: { op: 'and'|'or', conditions: [ {field, operator, value?} | <group> ] }
// The tree is validated, then compiled to a MongoDB query using ONLY known field keys and
// operators, with every value coerced by the field type. Raw client input never reaches Mongo.

const MAX_DEPTH = 3;
const MAX_CONDITIONS = 30;

const condition = z.object({
  field: z.string().min(1).max(60),
  operator: z.string().min(1).max(20),
  value: z.unknown().optional(),
});

const group = z.lazy(() =>
  z.object({ op: z.enum(['and', 'or']), conditions: z.array(z.union([condition, group])).max(MAX_CONDITIONS) }),
);

export const filterSchema = group;

const BUILTIN = {
  createdAt: { type: 'datetime', key: 'createdAt', builtin: true },
  updatedAt: { type: 'datetime', key: 'updatedAt', builtin: true },
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EMPTY_VALUES = [null, '', []];

function coerce(field, raw, label) {
  try {
    const v = parseValue({ ...field, min: null, max: null, required: false }, raw);
    if (v === null) throw new ValueError('A value is required');
    return v;
  } catch (e) {
    if (e instanceof ValueError) throw badRequest(`Filter on "${label}": ${e.message}`);
    throw e;
  }
}

function compileCondition(c, fieldsByKey) {
  const field = BUILTIN[c.field] || fieldsByKey.get(c.field);
  if (!field) throw badRequest(`Unknown field in filter: ${c.field}`);
  const allowed = OPERATORS[TYPES[field.type].group];
  if (!allowed.includes(c.operator)) throw badRequest(`Operator "${c.operator}" is not valid for ${field.type} fields`);

  const path = field.builtin ? field.key : `data.${field.key}`;
  const one = () => coerce(field, c.value, c.field);
  // Date values are stored as ISO strings; datetimes as Dates.
  const dayAgo = (n) => {
    const d = new Date(Date.now() + n * 864e5);
    return field.type === 'date' ? d.toISOString().slice(0, 10) : d;
  };
  const now = () => dayAgo(0);

  switch (c.operator) {
    case 'eq': return { [path]: one() };
    case 'ne': return { [path]: { $ne: one() } };
    case 'gt': return { [path]: { $gt: one() } };
    case 'gte': return { [path]: { $gte: one() } };
    case 'lt': return { [path]: { $lt: one() } };
    case 'lte': return { [path]: { $lte: one() } };
    case 'between': {
      if (!Array.isArray(c.value) || c.value.length !== 2) throw badRequest(`Filter on "${c.field}": between needs two values`);
      return { [path]: { $gte: coerce(field, c.value[0], c.field), $lte: coerce(field, c.value[1], c.field) } };
    }
    case 'contains':
      if (TYPES[field.type].group === 'multi') return { [path]: { $in: [].concat(c.value ?? []).map((v) => coerce({ ...field, type: 'dropdown' }, v, c.field)) } };
      return { [path]: { $regex: escapeRegex(coerce(field, c.value, c.field)), $options: 'i' } };
    case 'notContains':
      if (TYPES[field.type].group === 'multi') return { [path]: { $nin: [].concat(c.value ?? []).map((v) => coerce({ ...field, type: 'dropdown' }, v, c.field)) } };
      return { [path]: { $not: { $regex: escapeRegex(coerce(field, c.value, c.field)), $options: 'i' } } };
    case 'startsWith': return { [path]: { $regex: `^${escapeRegex(coerce(field, c.value, c.field))}`, $options: 'i' } };
    case 'in':
    case 'notIn': {
      const list = [].concat(c.value ?? []);
      if (list.length === 0 || list.length > 100) throw badRequest(`Filter on "${c.field}": provide 1-100 values`);
      return { [path]: { [c.operator === 'in' ? '$in' : '$nin']: list.map((v) => coerce(field, v, c.field)) } };
    }
    case 'empty': return { $or: [{ [path]: { $exists: false } }, { [path]: { $in: EMPTY_VALUES } }] };
    case 'notEmpty': return { [path]: { $exists: true, $nin: EMPTY_VALUES } };
    case 'isTrue': return { [path]: true };
    case 'isFalse': return { [path]: { $ne: true } };
    case 'inLastDays':
    case 'inNextDays': {
      const n = Number(c.value);
      if (!Number.isInteger(n) || n < 0 || n > 36500) throw badRequest(`Filter on "${c.field}": days must be a whole number`);
      return c.operator === 'inLastDays'
        ? { [path]: { $gte: dayAgo(-n), $lte: now() } }
        : { [path]: { $gte: now(), $lte: dayAgo(n) } };
    }
    default: throw badRequest(`Unsupported operator: ${c.operator}`);
  }
}

function compileGroup(g, fieldsByKey, depth, counter) {
  if (depth > MAX_DEPTH) throw badRequest('Filter groups are nested too deeply');
  const parts = g.conditions.map((node) => {
    if (++counter.n > MAX_CONDITIONS) throw badRequest('Filter has too many conditions');
    return 'conditions' in node ? compileGroup(node, fieldsByKey, depth + 1, counter) : compileCondition(node, fieldsByKey);
  }).filter(Boolean);
  if (parts.length === 0) return null;
  return { [g.op === 'and' ? '$and' : '$or']: parts };
}

export function compileFilter(filter, fields) {
  if (!filter) return null;
  const fieldsByKey = new Map(fields.map((f) => [f.key, f]));
  return compileGroup(filter, fieldsByKey, 1, { n: 0 });
}

const SEARCHABLE = new Set(['text', 'textarea', 'email', 'url', 'phone', 'dropdown']);

export function compileSearch(q, fields) {
  const term = (q || '').trim().slice(0, 100);
  if (!term) return null;
  const keys = fields.filter((f) => SEARCHABLE.has(f.type)).slice(0, 15);
  if (keys.length === 0) return null;
  const rx = { $regex: escapeRegex(term), $options: 'i' };
  return { $or: keys.map((f) => ({ [`data.${f.key}`]: rx })) };
}

export function compileSort(sort, fields) {
  const [key, dir] = String(sort || 'createdAt:desc').split(':');
  const sortable = new Set(['createdAt', 'updatedAt', ...fields.filter((f) => !['multiselect', 'textarea'].includes(f.type)).map((f) => f.key)]);
  if (!sortable.has(key)) throw badRequest(`Cannot sort by ${key}`);
  const path = key === 'createdAt' || key === 'updatedAt' ? key : `data.${key}`;
  return { [path]: dir === 'asc' ? 1 : -1, _id: 1 };
}
