import dayjs from 'dayjs';
import { Dataform } from '../dataforms/dataform.model.js';
import { RecordModel } from '../records/record.model.js';
import { label } from '../records/record.service.js';
import { env } from '../../config/env.js';

// Turns a record into the two value maps the automation layer needs:
//  - typed values for formulas ({value} is a number, {close_date} a Date, {tags} an array, ...)
//  - display strings for templates ({{stage}} is "Negotiation", {{company}} is the company's name)
// Relationships expose the id as {company} and the linked record's name as {company_label}.
// Reserved names: record (id, label, url), old (previous values), user, workflow.

const typed = (field, v) => {
  if (v === null || v === undefined) return null;
  if (field.type === 'date' || field.type === 'datetime') return new Date(v);
  if (field.type === 'relationship') return String(v);
  return v;
};

function display(field, v, relLabels) {
  if (v === null || v === undefined || v === '') return '';
  switch (field.type) {
    case 'dropdown': return field.options.find((o) => o.value === v)?.label ?? v;
    case 'multiselect': return v.map((x) => field.options.find((o) => o.value === x)?.label ?? x).join(', ');
    case 'boolean': return v ? 'Yes' : 'No';
    case 'date': return String(v);
    case 'datetime': return dayjs(v).toISOString();
    case 'relationship': return relLabels.get(String(v)) ?? '';
    case 'location': return `${v.lat},${v.lng}`;
    default: return String(v);
  }
}

async function relationshipLabels(account, fields, datas) {
  const labels = new Map();
  for (const f of fields.filter((x) => x.type === 'relationship')) {
    const ids = [...new Set(datas.map((d) => d?.[f.key]).filter(Boolean).map(String))];
    if (!ids.length) continue;
    const target = await Dataform.findOne({ _id: f.config.targetDataform, account }).lean();
    if (!target) continue;
    for (const r of await RecordModel.find({ _id: { $in: ids }, account, dataform: target._id }).lean()) labels.set(String(r._id), label(target, r));
  }
  return labels;
}

export async function buildContext({ account, dataform, fields, recordId, before, after, actor, workflow, now = new Date() }) {
  const current = after ?? before ?? {};
  const rel = await relationshipLabels(account, fields, [current, before]);
  const values = {}; const strings = {}; const oldValues = {};
  for (const f of fields) {
    values[f.key] = typed(f, current[f.key]);
    strings[f.key] = display(f, current[f.key], rel);
    oldValues[f.key] = typed(f, before?.[f.key]);
    if (f.type === 'relationship') {
      values[`${f.key}_label`] = rel.get(String(current[f.key])) ?? null;
      oldValues[`${f.key}_label`] = rel.get(String(before?.[f.key])) ?? null;
    }
  }
  const primary = dataform.primaryField ? (strings[dataform.primaryField] || current[dataform.primaryField]) : null;
  const recordInfo = {
    id: recordId ? String(recordId) : '', label: primary ? String(primary) : (recordId ? `#${String(recordId).slice(-6)}` : ''),
    url: recordId ? `${env.APP_URL}/w/${dataform.workspace}/f/${dataform._id}?record=${recordId}` : '',
  };
  const changed = new Set(fields.filter((f) => JSON.stringify(before?.[f.key] ?? null) !== JSON.stringify(current[f.key] ?? null)).map((f) => f.key));
  const meta = { user: { name: actor?.name ?? '', email: actor?.email ?? '' }, workflow: { name: workflow?.name ?? '' } };
  return {
    formula: { values: { ...values, record: recordInfo, old: oldValues, ...meta }, changed, now },
    template: { ...strings, record: recordInfo, ...meta },
  };
}
