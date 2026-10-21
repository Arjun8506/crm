import { z } from 'zod';
import { badRequest } from '../../utils/errors.js';
import { filterSchema, compileFilter, compileSearch } from '../records/filter.js';
import { RecordModel } from '../records/record.model.js';
import { resolveRefs } from '../records/record.service.js';

// Pivot-style grouping engine. Everything is computed by one MongoDB aggregation; field keys,
// intervals and operators are validated against the dataform's definitions first.

export const INTERVALS = ['day', 'week', 'month', 'quarter', 'year'];
const GROUPABLE = new Set(['text', 'email', 'phone', 'dropdown', 'boolean', 'date', 'datetime', 'relationship', 'integer', 'multiselect']);
const NUMERIC = new Set(['integer', 'decimal']);
const BUILTIN_DATES = { createdAt: '$createdAt', updatedAt: '$updatedAt' };

export const groupSpec = z.object({ field: z.string().max(60), interval: z.enum(INTERVALS).optional() });
export const metricSpec = z.object({ op: z.enum(['count', 'sum', 'avg', 'min', 'max']), field: z.string().max(60).optional() });

export const analyzeSchema = z.object({
  groupBy: z.array(groupSpec).max(3).default([]),
  metrics: z.array(metricSpec).min(1).max(5).default([{ op: 'count' }]),
  filter: filterSchema.optional(),
  q: z.string().max(100).optional(),
  page: z.number().int().min(1).max(10000).default(1),
  limit: z.number().int().min(1).max(200).default(50),
});

const isoDate = (d) => d.toISOString().slice(0, 10);
const addInterval = (d, interval) => {
  const n = new Date(d);
  if (interval === 'day') n.setUTCDate(n.getUTCDate() + 1);
  else if (interval === 'week') n.setUTCDate(n.getUTCDate() + 7);
  else if (interval === 'month') n.setUTCMonth(n.getUTCMonth() + 1);
  else if (interval === 'quarter') n.setUTCMonth(n.getUTCMonth() + 3);
  else n.setUTCFullYear(n.getUTCFullYear() + 1);
  return n;
};

function resolveGroup(spec, fieldsByKey) {
  const builtin = BUILTIN_DATES[spec.field];
  const field = builtin ? { key: spec.field, type: 'datetime', label: spec.field } : fieldsByKey.get(spec.field);
  if (!field) throw badRequest(`Unknown field: ${spec.field}`);
  if (!builtin && !GROUPABLE.has(field.type)) throw badRequest(`Cannot group by ${field.type} fields`);
  const isDate = field.type === 'date' || field.type === 'datetime';
  const interval = isDate ? (spec.interval || 'month') : null;
  const path = builtin || `$data.${field.key}`;
  let expr = path;
  if (isDate) {
    const date = field.type === 'date' ? { $dateFromString: { dateString: path, onError: null, onNull: null } } : path;
    expr = { $dateTrunc: { date, unit: interval, startOfWeek: 'monday' } };
  }
  return { field, interval, isDate, expr, unwind: field.type === 'multiselect' ? path : null };
}

function resolveMetric(spec, fieldsByKey) {
  if (spec.op === 'count') return { op: 'count', expr: { $sum: 1 } };
  const field = fieldsByKey.get(spec.field);
  if (!field || !NUMERIC.has(field.type)) throw badRequest(`${spec.op} needs a number field`);
  return { op: spec.op, field: field.key, expr: { [`$${spec.op}`]: `$data.${field.key}` } };
}

// Filter that returns exactly the records behind one group row (drill-down).
function drillFilter(groups, keys) {
  const conditions = groups.map((g, i) => {
    const value = keys[i];
    if (value === null || value === undefined) return { field: g.field.key, operator: 'empty' };
    if (g.isDate) {
      const start = new Date(value);
      const end = addInterval(start, g.interval);
      const upper = g.field.type === 'date' ? isoDate(new Date(end.getTime() - 864e5)) : new Date(end.getTime() - 1).toISOString();
      const lower = g.field.type === 'date' ? isoDate(start) : start.toISOString();
      return { field: g.field.key, operator: 'between', value: [lower, upper] };
    }
    if (g.field.type === 'boolean') return { field: g.field.key, operator: value ? 'isTrue' : 'isFalse' };
    if (g.field.type === 'multiselect') return { field: g.field.key, operator: 'contains', value: [value] };
    return { field: g.field.key, operator: 'eq', value };
  });
  return { op: 'and', conditions };
}

export async function analyze({ auth, dataform, fields, params }) {
  const fieldsByKey = new Map(fields.map((f) => [f.key, f]));
  const groups = params.groupBy.map((g) => resolveGroup(g, fieldsByKey));
  const metrics = params.metrics.map((m) => resolveMetric(m, fieldsByKey));

  const parts = [{ account: dataform.account, dataform: dataform._id }];
  const search = compileSearch(params.q, fields);
  const filter = compileFilter(params.filter, fields);
  if (search) parts.push(search);
  if (filter) parts.push(filter);

  const pipeline = [{ $match: { $and: parts } }];
  for (const g of groups) if (g.unwind) pipeline.push({ $unwind: { path: g.unwind, preserveNullAndEmptyArrays: true } });
  const accumulators = Object.fromEntries(metrics.map((m, i) => [`m${i}`, m.expr]));
  const sortKeys = Object.fromEntries(groups.map((_g, i) => [`_id.g${i}`, 1]));

  const [grouped] = await RecordModel.aggregate([
    ...pipeline,
    {
      $facet: {
        rows: [
          { $group: { _id: Object.fromEntries(groups.map((g, i) => [`g${i}`, g.expr])), ...accumulators } },
          ...(groups.length ? [{ $sort: sortKeys }] : []),
          { $skip: (params.page - 1) * params.limit },
          { $limit: params.limit },
        ],
        groupCount: [{ $group: { _id: Object.fromEntries(groups.map((g, i) => [`g${i}`, g.expr])) } }, { $count: 'n' }],
        totals: [{ $group: { _id: null, ...accumulators } }],
      },
    },
  ]);

  const rows = grouped.rows.map((r) => {
    const keys = groups.map((g, i) => {
      const v = r._id[`g${i}`];
      if (v === undefined || v === null) return null;
      if (g.isDate) return g.field.type === 'date' ? isoDate(v) : v.toISOString();
      return typeof v === 'object' ? String(v) : v;
    });
    return {
      keys,
      metrics: Object.fromEntries(metrics.map((_m, i) => [`m${i}`, r[`m${i}`] ?? null])),
      drill: drillFilter(groups, keys),
    };
  });

  // Resolve relationship group keys to labels.
  const refs = {};
  for (const [i, g] of groups.entries()) {
    if (g.field.type !== 'relationship') continue;
    const fake = rows.filter((r) => r.keys[i]).map((r) => ({ data: { [g.field.key]: r.keys[i] } }));
    Object.assign(refs, await resolveRefs(auth, dataform, [g.field], fake));
  }

  const totals = grouped.totals[0] || {};
  return {
    groups: groups.map((g) => ({ field: g.field.key, label: g.field.label, type: g.field.type, interval: g.interval })),
    metrics: metrics.map((m, i) => ({ key: `m${i}`, op: m.op, field: m.field ?? null })),
    rows,
    refs,
    total: grouped.groupCount[0]?.n ?? 0,
    page: params.page,
    limit: params.limit,
    totals: Object.fromEntries(metrics.map((_m, i) => [`m${i}`, totals[`m${i}`] ?? (metrics[i].op === 'count' ? 0 : null)])),
  };
}
