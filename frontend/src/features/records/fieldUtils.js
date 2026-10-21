import dayjs from 'dayjs';
import { z } from 'zod';

// Client-side mirror of the server's field rules, used for instant feedback. The server is authoritative.

export const TYPE_LABELS = {
  text: 'Text', textarea: 'Long text', email: 'Email', url: 'URL', phone: 'Phone', integer: 'Whole number', decimal: 'Decimal',
  boolean: 'Yes / No', date: 'Date', datetime: 'Date & time', dropdown: 'Dropdown', multiselect: 'Multi-select', relationship: 'Relationship', location: 'Location (map)',
};

export const OPERATOR_LABELS = {
  eq: 'is', ne: 'is not', contains: 'contains', notContains: 'does not contain', startsWith: 'starts with', empty: 'is empty',
  notEmpty: 'is not empty', gt: 'is greater than', gte: 'is at least', lt: 'is less than', lte: 'is at most', between: 'is between',
  isTrue: 'is yes', isFalse: 'is no', in: 'is any of', notIn: 'is none of', inLastDays: 'in the last (days)', inNextDays: 'in the next (days)',
};

// Operators with no value input.
export const NO_VALUE_OPERATORS = new Set(['empty', 'notEmpty', 'isTrue', 'isFalse']);

const GROUPS = {
  text: 'string', textarea: 'string', email: 'string', url: 'string', phone: 'string', integer: 'number', decimal: 'number',
  boolean: 'boolean', date: 'date', datetime: 'datetime', dropdown: 'choice', multiselect: 'multi', relationship: 'relationship', location: 'location',
};
const OPS = {
  string: ['eq', 'ne', 'contains', 'notContains', 'startsWith', 'empty', 'notEmpty'],
  number: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'notEmpty'],
  boolean: ['isTrue', 'isFalse'],
  date: ['eq', 'gt', 'gte', 'lt', 'lte', 'between', 'inLastDays', 'inNextDays', 'empty', 'notEmpty'],
  datetime: ['gt', 'gte', 'lt', 'lte', 'between', 'inLastDays', 'inNextDays', 'empty', 'notEmpty'],
  choice: ['eq', 'ne', 'in', 'notIn', 'empty', 'notEmpty'],
  multi: ['contains', 'notContains', 'empty', 'notEmpty'],
  relationship: ['eq', 'ne', 'in', 'empty', 'notEmpty'],
  location: ['empty', 'notEmpty'],
};
export const operatorsFor = (type) => OPS[GROUPS[type]];
export const groupOf = (type) => GROUPS[type];

export const optionLabel = (field, value) => field.options.find((o) => o.value === value)?.label ?? value;

export const formatValue = (field, value) => {
  if (value === null || value === undefined || value === '') return '';
  switch (field.type) {
    case 'date': return dayjs(value).format('MMM D, YYYY');
    case 'datetime': return dayjs(value).format('MMM D, YYYY h:mm A');
    case 'boolean': return value ? 'Yes' : 'No';
    case 'dropdown': return optionLabel(field, value);
    case 'multiselect': return value.map((v) => optionLabel(field, v)).join(', ');
    case 'decimal': return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
    case 'integer': return Number(value).toLocaleString();
    case 'location': return `${value.lat.toFixed(4)}, ${value.lng.toFixed(4)}`;
    default: return String(value);
  }
};

// ---- form <-> API value conversion ----

export function toFormValue(field, value) {
  if (field.type === 'boolean') return !!value;
  if (field.type === 'multiselect') return value ?? [];
  if (field.type === 'location') return { lat: value ? String(value.lat) : '', lng: value ? String(value.lng) : '' };
  if (value === null || value === undefined) return field.type === 'relationship' ? null : '';
  if (field.type === 'datetime') return dayjs(value).format('YYYY-MM-DDTHH:mm');
  if (field.type === 'relationship') return String(value);
  return String(value);
}

export function toApiValue(field, value) {
  if (field.type === 'boolean') return !!value;
  if (field.type === 'multiselect') return value ?? [];
  if (field.type === 'location') return value.lat === '' && value.lng === '' ? null : { lat: Number(value.lat), lng: Number(value.lng) };
  if (value === '' || value === null || value === undefined) return null;
  if (field.type === 'integer' || field.type === 'decimal') return Number(value);
  if (field.type === 'datetime') return new Date(value).toISOString();
  return value;
}

export function defaultFormValues(fields, record) {
  return Object.fromEntries(fields.map((f) => [
    f.key, toFormValue(f, record ? record.data?.[f.key] : f.defaultValue),
  ]));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fieldSchema(f) {
  const g = GROUPS[f.type];
  const req = f.required ? 'This field is required' : null;
  let s;
  if (g === 'boolean') return z.boolean();
  if (g === 'multi') return f.required ? z.array(z.string()).min(1, req) : z.array(z.string());
  if (g === 'location') {
    const num = (min, max) => (v) => v === '' || (Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max);
    return z.object({ lat: z.string(), lng: z.string() })
      .refine((v) => num(-90, 90)(v.lat), { message: 'Latitude must be between -90 and 90', path: ['lat'] })
      .refine((v) => num(-180, 180)(v.lng), { message: 'Longitude must be between -180 and 180', path: ['lng'] })
      .refine((v) => (v.lat === '') === (v.lng === ''), { message: 'Enter both latitude and longitude', path: ['lat'] })
      .refine((v) => !f.required || v.lat !== '', { message: req, path: ['lat'] });
  }
  if (g === 'relationship') return f.required ? z.string({ error: req }).min(1, req) : z.string().nullable();

  s = z.string();
  const check = (fn, msg) => { s = s.refine((v) => v === '' || fn(v), msg); };
  if (f.type === 'text') check((v) => v.length <= 500, 'At most 500 characters');
  if (f.type === 'textarea') check((v) => v.length <= 10000, 'At most 10,000 characters');
  if (f.type === 'email') check((v) => EMAIL.test(v), 'Enter a valid email');
  if (f.type === 'url') check((v) => /^https?:\/\/\S+$/i.test(v), 'Must start with http:// or https://');
  if (f.type === 'phone') check((v) => /^[+()\-.\s\d]+$/.test(v) && v.replace(/\D/g, '').length >= 5, 'Enter a valid phone number');
  if (f.type === 'integer') check((v) => Number.isInteger(Number(v)), 'Must be a whole number');
  if (f.type === 'decimal') check((v) => Number.isFinite(Number(v)), 'Must be a number');
  if (g === 'number') {
    if (f.min != null) check((v) => Number(v) >= f.min, `Must be at least ${f.min}`);
    if (f.max != null) check((v) => Number(v) <= f.max, `Must be at most ${f.max}`);
  }
  if (f.required) s = s.refine((v) => v.trim() !== '', req);
  return s;
}

export function buildFormSchema(fields) {
  return z.object(Object.fromEntries(fields.map((f) => [f.key, fieldSchema(f)])));
}

export const isFieldEditable = (f, mode) => !f.readOnly && f.visibility[mode === 'create' ? 'create' : 'edit'];
