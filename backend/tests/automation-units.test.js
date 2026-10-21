import './_env.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTree, matchField } from '../src/modules/workflows/conditions.js';
import { nextRun, scheduleSchema } from '../src/modules/workflows/schedule.js';
import { BlockedUrlError, assertPublicUrl, isPrivateAddress, setLookup } from '../src/providers/http.js';
import { backoffMs } from '../src/modules/queue/queue.js';
import { decrypt, encrypt, mask, safeEqual } from '../src/modules/integrations/secrets.js';

const F = {
  text: { key: 'name', type: 'text', label: 'Name', options: [] },
  num: { key: 'value', type: 'decimal', label: 'Value', options: [] },
  stage: { key: 'stage', type: 'dropdown', label: 'Stage', options: [{ value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }] },
  tags: { key: 'tags', type: 'multiselect', label: 'Tags', options: [{ value: 'vip', label: 'VIP' }, { value: 'event', label: 'Event' }] },
  date: { key: 'close', type: 'date', label: 'Close', options: [] },
  when: { key: 'at', type: 'datetime', label: 'At', options: [] },
  flag: { key: 'won', type: 'boolean', label: 'Won', options: [] },
  rel: { key: 'company', type: 'relationship', label: 'Company', options: [], config: { targetDataform: 'x' } },
};
const A = '5f1f1f1f1f1f1f1f1f1f1f1f'; const B = '6a2a2a2a2a2a2a2a2a2a2a2a';
const now = new Date('2026-10-25T12:00:00Z');
const m = (f, op, expected, actual) => matchField(F[f], op, expected, actual, now);

describe('workflow condition evaluator', () => {
  it('matches text with the same semantics as record filters', () => {
    assert.equal(m('text', 'eq', 'Acme', 'Acme'), true);
    assert.equal(m('text', 'eq', 'acme', 'Acme'), false, 'equality is exact');
    assert.equal(m('text', 'ne', 'Acme', undefined), true);
    assert.equal(m('text', 'contains', 'CM', 'Acme'), true, 'contains ignores case');
    assert.equal(m('text', 'notContains', 'zz', 'Acme'), true);
    assert.equal(m('text', 'startsWith', 'ac', 'Acme'), true);
    assert.equal(m('text', 'empty', undefined, ''), true);
    assert.equal(m('text', 'notEmpty', undefined, 'x'), true);
    assert.equal(m('text', 'contains', 'a', null), false);
  });

  it('compares numbers, dates, datetimes and booleans', () => {
    assert.equal(m('num', 'gt', 10, 11), true);
    assert.equal(m('num', 'gte', '10', 10), true, 'expected values are parsed like user input');
    assert.equal(m('num', 'lt', 10, undefined), false, 'empty is never less than');
    assert.equal(m('num', 'between', [1, 5], 3), true);
    assert.equal(m('num', 'between', [1, 5], 9), false);
    assert.equal(m('date', 'lt', '2026-12-01', '2026-11-30'), true);
    assert.equal(m('when', 'gte', '2026-01-01T00:00:00Z', new Date('2026-06-01T00:00:00Z')), true);
    assert.equal(m('date', 'inLastDays', 7, '2026-10-20'), true);
    assert.equal(m('date', 'inLastDays', 3, '2026-10-20'), false);
    assert.equal(m('date', 'inNextDays', 10, '2026-10-30'), true);
    assert.equal(m('flag', 'isTrue', undefined, true), true);
    assert.equal(m('flag', 'isFalse', undefined, undefined), true);
  });

  it('handles choices, lists and relationships', () => {
    assert.equal(m('stage', 'eq', 'won', 'won'), true);
    assert.equal(m('stage', 'in', ['won', 'lost'], 'lost'), true);
    assert.equal(m('stage', 'notIn', ['won'], 'lost'), true);
    assert.equal(m('tags', 'contains', ['vip'], ['vip', 'event']), true);
    assert.equal(m('tags', 'contains', ['vip'], []), false);
    assert.equal(m('tags', 'notContains', ['vip'], ['event']), true);
    assert.equal(m('rel', 'eq', A, A), true);
    assert.equal(m('rel', 'ne', A, B), true);
    assert.throws(() => m('stage', 'eq', 'nonsense', 'won'), /allowed options/);
    assert.throws(() => m('text', 'regex', 'x', 'y'), /Unsupported operator/);
  });

  const fields = new Map(Object.values(F).map((f) => [f.key, f]));
  const tree = (op, ...conditions) => ({ op, conditions });
  const field = (k, operator, value) => ({ kind: 'field', field: k, operator, value });
  const run = (t, current, changed = []) => evaluateTree(t, { fields, current, formula: { values: { ...current, old: {} }, changed: new Set(changed), now } });

  it('combines field tests, formulas and "changed" checks with AND / OR / nested groups', () => {
    const current = { name: 'Acme', value: 12000, stage: 'won' };
    assert.equal(run(null, current), true, 'no conditions means always');
    assert.equal(run(tree('and'), current), true);
    assert.equal(run(tree('and', field('stage', 'eq', 'won'), field('value', 'gte', 10000)), current), true);
    assert.equal(run(tree('and', field('stage', 'eq', 'won'), field('value', 'gte', 99999)), current), false);
    assert.equal(run(tree('or', field('stage', 'eq', 'lost'), field('value', 'gte', 10000)), current), true);
    assert.equal(run(tree('and', { kind: 'formula', expression: '{value} / 4 > 2000' }, field('stage', 'eq', 'won')), current), true);
    assert.equal(run(tree('and', { kind: 'formula', expression: '{value} < 100' }), current), false);
    assert.equal(run(tree('and', { kind: 'changed', field: 'stage' }), current, ['stage']), true);
    assert.equal(run(tree('and', { kind: 'changed', field: 'stage' }), current, ['value']), false);
    assert.equal(run(tree('and', field('stage', 'eq', 'won'), tree('or', field('name', 'contains', 'zzz'), { kind: 'formula', expression: 'LEN({name}) = 4' })), current), true);
    assert.throws(() => run(tree('and', { kind: 'formula', expression: '{value} / 0' }), current), /Division by zero/, 'a broken formula is an error, not a silent "false"');
  });
});

describe('schedules', () => {
  const at = (iso) => new Date(iso);
  const sched = (s) => ({ time: '09:00', timezone: 'UTC', ...s });

  it('computes the next hourly, daily, weekly and monthly runs', () => {
    assert.equal(nextRun(sched({ frequency: 'hourly', time: '00:30' }), at('2026-10-25T10:10:00Z')).toISOString(), '2026-10-25T10:30:00.000Z');
    assert.equal(nextRun(sched({ frequency: 'hourly', time: '00:30' }), at('2026-10-25T10:30:00Z')).toISOString(), '2026-10-25T11:30:00.000Z', 'strictly after');
    assert.equal(nextRun(sched({ frequency: 'daily' }), at('2026-10-25T08:00:00Z')).toISOString(), '2026-10-25T09:00:00.000Z');
    assert.equal(nextRun(sched({ frequency: 'daily' }), at('2026-10-25T09:00:00Z')).toISOString(), '2026-10-26T09:00:00.000Z');
    assert.equal(nextRun(sched({ frequency: 'weekly', dayOfWeek: 1 }), at('2026-10-25T10:00:00Z')).toISOString(), '2026-10-26T09:00:00.000Z', 'next Monday');
    assert.equal(nextRun(sched({ frequency: 'weekly', dayOfWeek: 0 }), at('2026-10-25T10:00:00Z')).toISOString(), '2026-11-01T09:00:00.000Z', 'today is Sunday but 09:00 has passed');
    assert.equal(nextRun(sched({ frequency: 'monthly', dayOfMonth: 15 }), at('2026-10-25T10:00:00Z')).toISOString(), '2026-11-15T09:00:00.000Z');
    assert.equal(nextRun(sched({ frequency: 'monthly', dayOfMonth: 28 }), at('2026-12-30T10:00:00Z')).toISOString(), '2027-01-28T09:00:00.000Z', 'rolls over the year');
  });

  it('keeps the local wall-clock time across daylight-saving changes', () => {
    const ny = sched({ frequency: 'daily', timezone: 'America/New_York' });
    assert.equal(nextRun(ny, at('2026-03-07T15:00:00Z')).toISOString(), '2026-03-08T13:00:00.000Z', '09:00 EDT the morning DST starts (UTC-4)');
    assert.equal(nextRun(ny, at('2026-03-06T20:00:00Z')).toISOString(), '2026-03-07T14:00:00.000Z', '09:00 EST the day before (UTC-5)');
    assert.equal(nextRun(ny, at('2026-10-31T20:00:00Z')).toISOString(), '2026-11-01T14:00:00.000Z', '09:00 EST once DST ends');
    assert.equal(nextRun(sched({ frequency: 'daily', timezone: 'Asia/Kolkata', time: '09:00' }), at('2026-10-25T00:00:00Z')).toISOString(), '2026-10-25T03:30:00.000Z', 'half-hour offsets work');
    assert.equal(nextRun(sched({ frequency: 'daily', timezone: 'Australia/Sydney', time: '09:00' }), at('2026-10-24T20:00:00Z')).toISOString(), '2026-10-24T22:00:00.000Z', 'southern hemisphere (UTC+11 in October)');
    // 02:30 does not exist on the spring-forward night in New York: it runs just after the gap instead of being skipped
    const skipped = nextRun(sched({ frequency: 'daily', timezone: 'America/New_York', time: '02:30' }), at('2026-03-08T00:00:00Z'));
    assert.equal(skipped.toISOString(), '2026-03-08T07:30:00.000Z');
  });

  it('rejects bad schedules', () => {
    assert.throws(() => scheduleSchema.parse({ frequency: 'daily', time: '25:00' }));
    assert.throws(() => scheduleSchema.parse({ frequency: 'daily', timezone: 'Mars/Phobos' }));
    assert.throws(() => scheduleSchema.parse({ frequency: 'monthly', dayOfMonth: 31 }));
    assert.throws(() => scheduleSchema.parse({ frequency: 'yearly' }));
  });
});

describe('queue backoff', () => {
  it('grows exponentially up to a cap', () => {
    assert.deepEqual([1, 2, 3, 4].map(backoffMs), [5000, 20000, 80000, 320000]);
    assert.equal(backoffMs(10), 30 * 60_000);
  });
});

describe('outbound URL safety (SSRF)', () => {
  it('classifies private and public addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fd12::1', 'fe80::1', '::ffff:10.0.0.1']) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
    for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
  });

  it('blocks internal targets, credentials, plain http and unresolvable hosts', async () => {
    setLookup(async (host) => (host === 'internal.example.com' ? [{ address: '10.0.0.5' }] : host === 'public.example.com' ? [{ address: '93.184.216.34' }] : host === 'mixed.example.com' ? [{ address: '93.184.216.34' }, { address: '127.0.0.1' }] : Promise.reject(new Error('ENOTFOUND'))));
    const bad = ['http://public.example.com/hook', 'https://internal.example.com/hook', 'https://mixed.example.com/hook', 'https://user:pw@public.example.com/', 'https://127.0.0.1/', 'https://[::1]/', 'https://169.254.169.254/latest/meta-data', 'https://nope.example.com/', 'not a url', 'ftp://public.example.com/x'];
    for (const url of bad) await assert.rejects(assertPublicUrl(url), BlockedUrlError, url);
    assert.equal((await assertPublicUrl('https://public.example.com/hook?x=1')).hostname, 'public.example.com');
    setLookup(undefined);
  });
});

describe('secrets', () => {
  it('encrypts with authentication and detects tampering', () => {
    const token = encrypt({ authToken: 'super-secret' });
    assert.ok(token.startsWith('v1.') && !token.includes('super-secret'));
    assert.deepEqual(decrypt(token), { authToken: 'super-secret' });
    assert.notEqual(encrypt({ a: 1 }), encrypt({ a: 1 }), 'a fresh IV every time');
    const parts = token.split('.');
    parts[3] = Buffer.from('tampered-data').toString('base64url');
    assert.throws(() => decrypt(parts.join('.')));
    assert.throws(() => decrypt('garbage'));
    assert.equal(mask('abcdef1234'), '••••1234');
    assert.equal(safeEqual('a', 'a'), true);
    assert.equal(safeEqual('a', 'ab'), false);
  });
});
