import mongoose from 'mongoose';

// Single source of truth for what each custom field type stores, validates and can be filtered by.

export class ValueError extends Error {}

const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const fail = (msg) => { throw new ValueError(msg); };

const text = (max) => (v) => {
  if (typeof v !== 'string') fail('Must be text');
  const t = v.trim();
  if (t.length > max) fail(`Must be at most ${max} characters`);
  return t;
};

const number = (v) => {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  if (!Number.isFinite(n)) fail('Must be a number');
  return n;
};

const isoDate = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail('Must be a date (YYYY-MM-DD)');
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) fail('Invalid date');
  return v;
};

const dateTime = (v) => {
  const d = new Date(v);
  if ((typeof v !== 'string' && typeof v !== 'number') || Number.isNaN(d.getTime())) fail('Must be a date and time');
  return d;
};

export const TYPES = {
  text: { group: 'string', parse: text(500) },
  textarea: { group: 'string', parse: text(10000) },
  email: {
    group: 'string',
    parse: (v) => {
      const t = text(254)(v).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) fail('Must be a valid email');
      return t;
    },
  },
  url: {
    group: 'string',
    parse: (v) => {
      const t = text(2000)(v);
      let u;
      try { u = new URL(t); } catch { fail('Must be a valid URL'); }
      if (!['http:', 'https:'].includes(u.protocol)) fail('URL must start with http:// or https://');
      return t;
    },
  },
  phone: {
    group: 'string',
    parse: (v) => {
      const t = text(30)(v);
      if (!/^[+()\-.\s\d]+$/.test(t) || t.replace(/\D/g, '').length < 5) fail('Must be a valid phone number');
      return t;
    },
  },
  integer: { group: 'number', parse: (v) => { const n = number(v); if (!Number.isInteger(n)) fail('Must be a whole number'); return n; } },
  decimal: { group: 'number', parse: number },
  boolean: {
    group: 'boolean',
    parse: (v) => {
      if (v === true || v === 'true') return true;
      if (v === false || v === 'false') return false;
      return fail('Must be true or false');
    },
  },
  date: { group: 'date', parse: isoDate },
  datetime: { group: 'datetime', parse: dateTime },
  dropdown: {
    group: 'choice',
    parse: (v, f) => {
      if (typeof v !== 'string' || !f.options.some((o) => o.value === v)) fail('Not one of the allowed options');
      return v;
    },
  },
  multiselect: {
    group: 'multi',
    parse: (v, f) => {
      if (!Array.isArray(v) || v.length > 50) fail('Must be a list of options');
      const allowed = new Set(f.options.map((o) => o.value));
      if (!v.every((x) => typeof x === 'string' && allowed.has(x))) fail('Contains an option that is not allowed');
      return [...new Set(v)];
    },
  },
  location: {
    group: 'location',
    parse: (v) => {
      const lat = Number(v?.lat);
      const lng = Number(v?.lng);
      if (v === null || typeof v !== 'object' || !Number.isFinite(lat) || !Number.isFinite(lng)) fail('Must be a location with lat and lng');
      if (lat < -90 || lat > 90) fail('Latitude must be between -90 and 90');
      if (lng < -180 || lng > 180) fail('Longitude must be between -180 and 180');
      return { lat, lng };
    },
  },
  relationship: {
    group: 'relationship',
    parse: (v) => {
      if (typeof v !== 'string' || !mongoose.isValidObjectId(v) || v.length !== 24) fail('Must reference a record');
      return new mongoose.Types.ObjectId(v);
    },
  },
};

export const TYPE_NAMES = Object.keys(TYPES);

export const OPERATORS = {
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

export const operatorsFor = (type) => OPERATORS[TYPES[type].group];

// Parse a user-supplied value for a field. Returns null for empty input.
export function parseValue(field, raw) {
  if (isEmpty(raw)) return null;
  const value = TYPES[field.type].parse(raw, field);
  if (TYPES[field.type].group === 'number') {
    if (field.min != null && value < field.min) fail(`Must be at least ${field.min}`);
    if (field.max != null && value > field.max) fail(`Must be at most ${field.max}`);
  }
  return value;
}

export { isEmpty };
