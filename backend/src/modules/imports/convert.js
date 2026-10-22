import { ValueError } from '../dataforms/fieldTypes.js';

// Turns a CSV cell into the value the field's own validator expects. Anything wrong throws ValueError with a readable message.
// Relationship cells are resolved to record ids by the caller (they need the database).

const TRUE = new Set(['true', 'yes', 'y', '1', 'on']);
const FALSE = new Set(['false', 'no', 'n', '0', 'off']);
const pad = (n) => String(n).padStart(2, '0');

function ymd(y, m, d) {
  const iso = `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) throw new ValueError('Not a real calendar date');
  return iso;
}

// Accepts ISO (2024-03-05) always; dd/mm/yyyy or mm/dd/yyyy (also with - or .) according to the chosen format.
export function parseDateCell(text, format) {
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(text);
  if (m) return ymd(m[1], m[2], m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (m) {
    if (format === 'dmy') return ymd(m[3], m[2], m[1]);
    if (format === 'mdy') return ymd(m[3], m[1], m[2]);
    throw new ValueError('Use YYYY-MM-DD, or choose the day/month order for this file');
  }
  throw new ValueError('Not a recognised date');
}

// Times without a zone are read as UTC (the import has no way to know the sender's zone).
export function parseDateTimeCell(text, format) {
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text;
  const m = /^(.*?)(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(Z|[+-]\d{2}:?\d{2})?)?$/.exec(text);
  const iso = parseDateCell(m[1], format);
  const tz = m[5] ? m[5].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2') : 'Z';
  return `${iso}T${pad(m[2] ?? 0)}:${m[3] ?? '00'}:${m[4] ?? '00'}${tz}`;
}

export function convertCell(field, raw, { dateFormat = 'iso' } = {}) {
  const text = String(raw ?? '').trim();
  if (text === '') return undefined;
  switch (field.type) {
    case 'boolean': {
      const k = text.toLowerCase();
      if (TRUE.has(k)) return true;
      if (FALSE.has(k)) return false;
      throw new ValueError('Use Yes or No');
    }
    case 'date': return parseDateCell(text, dateFormat);
    case 'datetime': return parseDateTimeCell(text, dateFormat);
    case 'dropdown': {
      const k = text.toLowerCase();
      const hit = field.options.find((o) => o.label.toLowerCase() === k || o.value.toLowerCase() === k);
      if (!hit) throw new ValueError(`"${text}" is not one of: ${field.options.map((o) => o.label).join(', ')}`);
      return hit.value;
    }
    case 'multiselect': {
      const find = (t) => field.options.find((o) => o.label.toLowerCase() === t.toLowerCase() || o.value.toLowerCase() === t.toLowerCase());
      let parts = text.split(/[;|]/).map((t) => t.trim()).filter(Boolean);
      if (parts.length === 1 && parts[0].includes(',') && !find(parts[0])) parts = parts[0].split(',').map((t) => t.trim()).filter(Boolean);
      const out = parts.map((p) => {
        const hit = find(p);
        if (!hit) throw new ValueError(`"${p}" is not one of: ${field.options.map((o) => o.label).join(', ')}`);
        return hit.value;
      });
      return out;
    }
    case 'location': {
      const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
      if (!m) throw new ValueError('Use "latitude,longitude"');
      return { lat: Number(m[1]), lng: Number(m[2]) };
    }
    default: return text;
  }
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

// Suggests which field each column belongs to by comparing header text to field labels and keys.
export function suggestMapping(headers, fields) {
  const used = new Set();
  const out = [];
  headers.forEach((h, column) => {
    const n = norm(h);
    if (!n) return;
    const f = fields.find((x) => !used.has(x.key) && (norm(x.label) === n || norm(x.key) === n));
    if (f) { used.add(f.key); out.push({ column, field: f.key }); }
  });
  return out;
}
