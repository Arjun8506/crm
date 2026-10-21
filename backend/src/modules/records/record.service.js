import { badRequest } from '../../utils/errors.js';
import { Dataform, FieldDefinition } from '../dataforms/dataform.model.js';
import { ValueError, isEmpty, parseValue } from '../dataforms/fieldTypes.js';
import { RecordHistory, RecordModel } from './record.model.js';

export const loadFields = (dataformId) => FieldDefinition.find({ dataform: dataformId }).sort({ order: 1, createdAt: 1 }).lean();

const validation = (errors) => badRequest('Validation failed', Object.entries(errors).map(([k, message]) => ({ path: `data.${k}`, message })));

// Validates and coerces client input against field definitions.
// mode 'create': applies defaults and enforces required fields.
// mode 'update': only keys present are touched.
// `system: true` is for writes made by workflows: read-only and hidden fields may be set, required fields are still enforced.
export function buildData(fields, input, mode, { system = false } = {}) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const errors = {};
  const data = {};
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  for (const key of Object.keys(source)) {
    const f = byKey.get(key);
    if (!f) { errors[key] = 'Unknown field'; continue; }
    if (f.readOnly && !system) { errors[key] = 'This field is read-only'; continue; }
    if (!system && !f.visibility[mode === 'create' ? 'create' : 'edit']) { errors[key] = `This field cannot be set on ${mode}`; continue; }
    try {
      const v = parseValue(f, source[key]);
      if (v === null && f.required) errors[key] = 'This field is required';
      else data[key] = v;
    } catch (e) {
      if (!(e instanceof ValueError)) throw e;
      errors[key] = e.message;
    }
  }

  if (mode === 'create') {
    for (const f of fields) {
      if (f.key in source) continue;
      if (!isEmpty(f.defaultValue)) {
        try { data[f.key] = parseValue(f, f.defaultValue); } catch { /* invalid default is ignored */ }
      } else if (f.required && (system || (f.visibility.create && !f.readOnly))) {
        errors[f.key] = 'This field is required';
      }
    }
  }
  if (Object.keys(errors).length) throw validation(errors);
  return data;
}

// Async checks that need the database: relationship targets and uniqueness.
export async function checkReferences(auth, dataform, fields, data, { excludeId, skipUnique } = {}) {
  const errors = {};
  for (const f of fields) {
    const v = data[f.key];
    if (v === undefined || v === null) continue;
    if (f.type === 'relationship') {
      const ok = await RecordModel.exists({
        _id: v, account: auth.accountId, workspace: dataform.workspace, dataform: f.config.targetDataform,
      });
      if (!ok) errors[f.key] = 'Referenced record does not exist';
    } else if (f.unique && !skipUnique) {
      const clash = await RecordModel.exists({
        account: auth.accountId, dataform: dataform._id, [`data.${f.key}`]: v, ...(excludeId ? { _id: { $ne: excludeId } } : {}),
      });
      if (clash) errors[f.key] = 'This value is already used by another record';
    }
  }
  if (Object.keys(errors).length) throw validation(errors);
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function diff(before, after) {
  const changes = [];
  for (const key of Object.keys(after)) {
    if (!same(before?.[key], after[key])) changes.push({ field: key, from: before?.[key] ?? null, to: after[key] });
  }
  return changes.slice(0, 100);
}

export const writeHistory = (entries) => (entries.length ? RecordHistory.insertMany(entries) : Promise.resolve());

// Adds { [fieldKey]: { [recordId]: label } } so the client can render relationship values.
export async function resolveRefs(auth, dataform, fields, records) {
  const refs = {};
  for (const f of fields.filter((x) => x.type === 'relationship')) {
    const ids = [...new Set(records.map((r) => r.data?.[f.key]).filter(Boolean).map(String))];
    refs[f.key] = {};
    if (ids.length === 0) continue;
    const target = await Dataform.findOne({ _id: f.config.targetDataform, account: auth.accountId }).lean();
    if (!target) continue;
    const rows = await RecordModel.find({ _id: { $in: ids }, account: auth.accountId, dataform: target._id }).lean();
    for (const r of rows) refs[f.key][String(r._id)] = label(target, r);
  }
  return refs;
}

export const label = (dataform, record) => {
  const v = dataform.primaryField ? record.data?.[dataform.primaryField] : null;
  return v ? String(v) : `#${String(record._id).slice(-6)}`;
};

// Fields hidden from list views are removed from list responses.
export function projectForList(fields, records) {
  const hidden = fields.filter((f) => !f.visibility.list).map((f) => f.key);
  if (hidden.length === 0) return records;
  return records.map((r) => ({ ...r, data: Object.fromEntries(Object.entries(r.data || {}).filter(([k]) => !hidden.includes(k))) }));
}
