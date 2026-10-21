import dayjs from 'dayjs';
import { RecordModel } from './record.model.js';
import { resolveRefs } from './record.service.js';

const MAX_ROWS = 50000;
const BATCH = 500;

// Cells starting with = + - @ are executed as formulas by spreadsheet apps; prefix them with an apostrophe.
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function format(field, value, refs) {
  if (value === null || value === undefined) return '';
  switch (field.type) {
    case 'boolean': return value ? 'Yes' : 'No';
    case 'datetime': return dayjs(value).toISOString();
    case 'dropdown': return field.options.find((o) => o.value === value)?.label ?? value;
    case 'multiselect': return value.map((v) => field.options.find((o) => o.value === v)?.label ?? v).join('; ');
    case 'relationship': return refs[field.key]?.[String(value)] ?? '';
    case 'location': return `${value.lat},${value.lng}`;
    default: return value;
  }
}

export async function toCsv({ res, auth, dataform, fields, query, sort }) {
  res.write(`${fields.map((f) => csvCell(f.label)).join(',')}\r\n`);
  let sent = 0;
  let batch = [];
  const flush = async () => {
    const refs = await resolveRefs(auth, dataform, fields, batch);
    for (const r of batch) res.write(`${fields.map((f) => csvCell(format(f, r.data?.[f.key], refs))).join(',')}\r\n`);
    batch = [];
  };
  for await (const r of RecordModel.find(query).sort(sort).limit(MAX_ROWS).lean().cursor()) {
    batch.push(r);
    sent++;
    if (batch.length >= BATCH) await flush();
  }
  if (batch.length) await flush();
  res.end();
  return sent;
}
