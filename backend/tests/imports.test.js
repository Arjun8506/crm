import './_env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { parseCsv } from '../src/modules/imports/csvParse.js';

let mongod; let app; let drain; let RecordModel; let RecordHistory; let ImportJob; let ExportJob; let purgeExpiredJobs;
const tokens = {};
const OWNER = 'owner@acme.test'; const MEMBER = 'member@acme.test'; const GLOBEX = 'owner@globex.test';
const api = (method, who, url, body) => {
  const r = request(app)[method](`/api/v1${url}`).set({ Authorization: `Bearer ${tokens[who]}` });
  return body === undefined ? r : r.send(body);
};
const upload = (who, dataformId, csv, filename = 'people.csv') => request(app).post(`/api/v1/dataforms/${dataformId}/imports`).set({ Authorization: `Bearer ${tokens[who]}` }).attach('file', Buffer.from(csv), { filename, contentType: 'text/csv' });
const wait = async (who, id) => { await drain(); return (await api('get', who, `/imports/${id}`)).body.import; };
const col = (job, header) => job.headers.indexOf(header);

let ws; let contacts; let companies; let deals;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('orgcrm_test'));
  const { createApp } = await import('../src/app.js');
  const { seed } = await import('../src/seed/seed.js');
  ({ drain } = await import('../src/modules/queue/queue.js'));
  ({ RecordModel, RecordHistory } = await import('../src/modules/records/record.model.js'));
  ({ ImportJob, ExportJob } = await import('../src/modules/imports/job.models.js'));
  ({ purgeExpiredJobs } = await import('../src/modules/imports/cleanup.js'));
  await seed();
  await mongoose.syncIndexes();
  app = createApp();
  for (const who of [OWNER, MEMBER, GLOBEX]) tokens[who] = (await request(app).post('/api/v1/auth/login').send({ email: who, password: 'Passw0rd!demo' })).body.accessToken;
  ws = (await api('post', OWNER, '/workspaces', { name: 'Import space' })).body.workspace;
  const mk = async (name, templateId) => (await api('post', OWNER, '/dataforms', { workspaceId: ws._id, name, templateId })).body.dataform;
  contacts = await mk('People', 'contacts'); companies = await mk('Firms', 'companies'); deals = await mk('Pipeline', 'deals');
  await api('post', OWNER, `/dataforms/${deals._id}/fields`, { key: 'company', label: 'Company', type: 'relationship', config: { targetDataform: companies._id } }).expect(201);
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('csv parser', () => {
  it('handles quotes, embedded newlines, escaped quotes, BOM, CRLF and blank lines', () => {
    const { rows } = parseCsv('﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n\r\n"multi\nline",,3\r\n');
    assert.deepEqual(rows, [['a', 'b', 'c'], ['1', 'x, y', 'say "hi"'], ['multi\nline', '', '3']]);
  });
  it('detects semicolon and tab delimiters, and rejects unclosed quotes and oversized files', () => {
    assert.deepEqual(parseCsv('a;b\n1;2').rows, [['a', 'b'], ['1', '2']]);
    assert.deepEqual(parseCsv('a\tb\n1\t2').rows, [['a', 'b'], ['1', '2']]);
    assert.throws(() => parseCsv('a,b\n"oops,1'), /never closed/);
    assert.throws(() => parseCsv('a\n1\n2\n3', { maxRows: 2 }), /more than 2 rows/);
  });
});

describe('uploading', () => {
  it('previews the file and suggests a mapping from the headings', async () => {
    const res = await upload(OWNER, contacts._id, 'Full name,E-mail,Phone,Mystery\nAda,ada@x.test,+1 555 0100,?\nBob,bob@x.test,,\n');
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.import.rowCount, 2);
    assert.deepEqual(res.body.import.headers, ['Full name', 'E-mail', 'Phone', 'Mystery']);
    assert.equal(res.body.import.sample.length, 2);
    assert.equal(res.body.import.storageKey, undefined, 'storage details are never exposed');
    const m = Object.fromEntries(res.body.suggestedMapping.map((s) => [s.column, s.field]));
    assert.deepEqual(m, { 0: 'name', 1: 'email', 2: 'phone' });
    assert.ok(res.body.fields.some((f) => f.key === 'email' && f.unique));
  });

  it('rejects bad files and people who may not import', async () => {
    assert.equal((await upload(OWNER, contacts._id, 'a,b\n', 'x.csv')).status, 400, 'no data rows');
    assert.equal((await upload(OWNER, contacts._id, '', 'x.csv')).status, 400);
    assert.equal((await upload(OWNER, contacts._id, 'a,b\n1,2\n', 'x.exe')).status, 400);
    assert.equal((await upload(OWNER, contacts._id, 'a\n"x', 'x.csv')).status, 400, 'unclosed quote');
    assert.equal((await request(app).post(`/api/v1/dataforms/${contacts._id}/imports`).set({ Authorization: `Bearer ${tokens[OWNER]}` })).status, 400, 'no file');
    assert.equal((await upload(GLOBEX, contacts._id, 'a\n1\n')).status, 404, 'other tenants cannot see the dataform');
    assert.equal((await request(app).post(`/api/v1/dataforms/${contacts._id}/imports`).attach('file', Buffer.from('a\n1'), 'x.csv')).status, 401);
    const big = await upload(OWNER, contacts._id, `a\n${'x'.repeat(11 * 1024 * 1024)}`);
    assert.equal(big.status, 413);
  });
});

describe('running an import', () => {
  const CSV = [
    'Full name,Email,Phone,Status,Tags,Last contacted,Notes',
    'Ada Lovelace,ada@imp.test,+44 20 7946 0000,Customer,VIP; Partner,05/03/2024,ignored',
    'Grace Hopper,grace@imp.test,,prospect,Newsletter,31/12/2023,',
    'No Email,,,,,,',
    'Bad Email,not-an-email,,,,,',
    'Bad Status,bs@imp.test,,Frenemy,,,',
    'Bad Date,bd@imp.test,,,,31/02/2024,',
    ',nobody@imp.test,,,,,',
    'Dupe In File,ada@imp.test,,,,,',
  ].join('\n');
  let job;

  const map = (j, pairs) => Object.entries(pairs).map(([header, field]) => ({ column: col(j, header), field }));
  const MAPPING = { 'Full name': 'name', Email: 'email', Phone: 'phone', Status: 'status', Tags: 'tags', 'Last contacted': 'last_contacted' };

  it('validates the mapping before starting', async () => {
    const up = (await upload(OWNER, contacts._id, CSV)).body.import;
    job = up;
    const start = (body) => api('post', OWNER, `/imports/${up._id}/start`, body);
    assert.equal((await start({ mapping: [] })).status, 400);
    assert.match((await start({ mapping: [{ column: 1, field: 'email' }] })).body.error.message, /"Full name" \(it is required\)/);
    assert.equal((await start({ mapping: [{ column: 0, field: 'name' }, { column: 1, field: 'name' }] })).status, 400, 'field used twice');
    assert.equal((await start({ mapping: [{ column: 0, field: 'name' }, { column: 0, field: 'email' }] })).status, 400, 'column used twice');
    assert.equal((await start({ mapping: [{ column: 99, field: 'name' }] })).status, 400);
    assert.equal((await start({ mapping: [{ column: 0, field: 'ghost' }] })).status, 400, 'unknown field');
    assert.equal((await start({ mapping: [{ column: 0, field: 'name' }], matchField: 'email' })).status, 400, 'match field must be mapped');
    assert.equal((await api('post', GLOBEX, `/imports/${up._id}/start`, { mapping: [{ column: 0, field: 'name' }] })).status, 404);
    assert.equal((await api('get', MEMBER, `/imports/${up._id}`)).status, 404, 'belongs to whoever uploaded it');
  });

  it('a dry run checks every row and writes nothing', async () => {
    const res = await api('post', OWNER, `/imports/${job._id}/start`, { mapping: map(job, MAPPING), dateFormat: 'dmy', dryRun: true });
    assert.equal(res.status, 202, JSON.stringify(res.body));
    const done = await wait(OWNER, job._id);
    assert.equal(done.status, 'done');
    assert.equal(done.dryRun, true);
    assert.deepEqual(done.counts, { created: 3, updated: 0, skipped: 0, failed: 5 });
    assert.equal(await RecordModel.countDocuments({ dataform: contacts._id }), 0);
    assert.equal(done.errors.find((e) => e.row === 6).message, 'Status: "Frenemy" is not one of: Lead, Prospect, Customer, Churned');
    assert.match(done.errors.find((e) => e.row === 9).message, /Email: This value appears more than once in the file/);
  });

  it('then runs for real from the same upload, importing good rows and reporting bad ones', async () => {
    const res = await api('post', OWNER, `/imports/${job._id}/start`, { mapping: map(job, MAPPING), dateFormat: 'dmy' });
    assert.equal(res.status, 202);
    assert.equal((await api('post', OWNER, `/imports/${job._id}/start`, { mapping: map(job, MAPPING) })).status, 409, 'cannot start twice');
    const done = await wait(OWNER, job._id);
    assert.equal(done.status, 'done');
    assert.deepEqual(done.counts, { created: 3, updated: 0, skipped: 0, failed: 5 });
    assert.equal(done.processed, 8);

    const recs = await RecordModel.find({ dataform: contacts._id }).sort({ createdAt: 1 }).lean();
    assert.equal(recs.length, 3, 'a row without an email is fine: email is optional');
    assert.deepEqual(recs[0].data, { name: 'Ada Lovelace', email: 'ada@imp.test', phone: '+44 20 7946 0000', status: 'customer', tags: ['vip', 'partner'], last_contacted: '2024-03-05' });
    assert.equal(recs[1].data.status, 'prospect');
    assert.equal(recs[1].data.last_contacted, '2023-12-31', 'dd/mm/yyyy read as day first');
    assert.equal(recs[1].data.notes, undefined, 'unmapped columns are not imported');

    const msgs = Object.fromEntries(done.errors.map((e) => [e.row, e.message]));
    assert.match(msgs[5], /Email: Must be a valid email/);
    assert.match(msgs[6], /Status: "Frenemy" is not one of/);
    assert.match(msgs[7], /Last contacted: Not a real calendar date/);
    assert.match(msgs[8], /Full name: This field is required/);
    assert.match(msgs[9], /Email: This value is already used by another record/);
    assert.equal(done.hasErrorsFile, true);
    assert.equal(done.storageKey, undefined);
  });

  it('records where the data came from, and tells the person who ran it', async () => {
    const rec = await RecordModel.findOne({ dataform: contacts._id, 'data.email': 'ada@imp.test' });
    const history = await RecordHistory.find({ record: rec._id }).lean();
    assert.equal(history[0].source, 'import');
    const hist = (await api('get', OWNER, `/dataforms/${contacts._id}/records/${rec._id}/history`)).body.data;
    assert.equal(hist[0].source, 'import');
    const note = (await api('get', OWNER, '/notifications?limit=20')).body.data.find((n) => n.type === 'job_done' && n.title.startsWith('Import finished'));
    assert.ok(note);
    assert.match(note.body, /3 created, 0 updated, 0 skipped, 5 failed/);
  });

  it('gives back the rows that failed, with the reason, ready to fix and re-import', async () => {
    const res = await api('get', OWNER, `/imports/${job._id}/errors`);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/csv/);
    const { rows } = parseCsv(res.text);
    assert.deepEqual(rows[0].slice(0, 3), ['Row', 'Error', 'Full name']);
    assert.equal(rows.length, 6);
    const bad = rows.find((r) => r[0] === '6');
    assert.equal(bad[2], 'Bad Status');
    assert.match(bad[1], /Frenemy/);
    assert.equal((await api('get', GLOBEX, `/imports/${job._id}/errors`)).status, 404);
    assert.equal((await api('get', MEMBER, `/imports/${job._id}/errors`)).status, 404);
  });

  it('lists past imports for the dataform', async () => {
    const list = (await api('get', OWNER, `/dataforms/${contacts._id}/imports`)).body.data;
    assert.ok(list.length >= 1);
    assert.equal(list[0].user.name.length > 0, true);
    assert.equal(list[0].storageKey, undefined);
  });
});

describe('duplicates', () => {
  const run = async (csv, extra) => {
    const up = (await upload(OWNER, contacts._id, csv)).body.import;
    const mapping = [{ column: 0, field: 'name' }, { column: 1, field: 'email' }, { column: 2, field: 'status' }];
    const res = await api('post', OWNER, `/imports/${up._id}/start`, { mapping, ...extra });
    assert.equal(res.status, 202, JSON.stringify(res.body));
    return wait(OWNER, up._id);
  };
  const csv = 'Name,Email,Status\nAda Changed,ada@imp.test,Churned\nNew Person,new@imp.test,Lead\n';

  it('skips rows that match an existing record', async () => {
    const done = await run(csv, { duplicate: 'skip', matchField: 'email' });
    assert.deepEqual(done.counts, { created: 1, updated: 0, skipped: 1, failed: 0 });
    assert.equal((await RecordModel.findOne({ 'data.email': 'ada@imp.test' })).data.name, 'Ada Lovelace');
  });

  it('updates the matching record and records the change', async () => {
    const done = await run('Name,Email,Status\nAda Changed,ada@imp.test,Churned\n', { duplicate: 'update', matchField: 'email' });
    assert.deepEqual(done.counts, { created: 0, updated: 1, skipped: 0, failed: 0 });
    const rec = await RecordModel.findOne({ 'data.email': 'ada@imp.test' });
    assert.equal(rec.data.name, 'Ada Changed');
    assert.equal(rec.data.status, 'churned');
    assert.equal(rec.data.phone, '+44 20 7946 0000', 'columns not in the file are left alone');
    const h = await RecordHistory.find({ record: rec._id, action: 'update' }).lean();
    assert.equal(h.at(-1).source, 'import');
    assert.deepEqual(h.at(-1).changes.map((c) => c.field).sort(), ['name', 'status']);
  });

  it('can treat a match as an error', async () => {
    const done = await run('Name,Email,Status\nAda Again,ada@imp.test,Lead\n', { duplicate: 'error', matchField: 'email' });
    assert.deepEqual(done.counts, { created: 0, updated: 0, skipped: 0, failed: 1 });
    assert.match(done.errors[0].message, /already exists/);
  });

  it('a bad value in the matching column fails only that row, not the whole import', async () => {
    const done = await run('Name,Email,Status\nGood Match,good-match@imp.test,Lead\nBad Match,not-an-email,Lead\nAfter Bad,after-bad@imp.test,Lead\n', { duplicate: 'update', matchField: 'email' });
    assert.equal(done.status, 'done', done.failure);
    assert.deepEqual(done.counts, { created: 2, updated: 0, skipped: 0, failed: 1 });
    assert.match(done.errors[0].message, /Email: Must be a valid email/);
  });

  it('a dry run predicts what will happen to repeats inside the file', async () => {
    const done = await run('Name,Email,Status\nZed,zed@imp.test,Lead\nZed Again,zed@imp.test,Lead\n', { duplicate: 'skip', matchField: 'email', dryRun: true });
    assert.deepEqual(done.counts, { created: 1, updated: 0, skipped: 1, failed: 0 });
    assert.equal(await RecordModel.countDocuments({ 'data.email': 'zed@imp.test' }), 0);
  });
});

describe('relationships and rules', () => {
  const MAP = [{ column: 0, field: 'title' }, { column: 1, field: 'company' }, { column: 2, field: 'value' }, { column: 3, field: 'won' }, { column: 4, field: 'stage' }];
  const importDeals = async (csv, extra = {}) => {
    const up = (await upload(OWNER, deals._id, csv)).body.import;
    const res = await api('post', OWNER, `/imports/${up._id}/start`, { mapping: MAP, ...extra });
    assert.equal(res.status, 202, JSON.stringify(res.body));
    return wait(OWNER, up._id);
  };

  it('links records by the other dataform\'s name, and reports names that are missing or ambiguous', async () => {
    const acme = (await api('post', OWNER, `/dataforms/${companies._id}/records`, { data: { name: 'Acme Corp' } })).body.record;
    await RecordModel.create([1, 2].map(() => ({ account: ws.account, workspace: ws._id, dataform: companies._id, data: { name: 'Twin' } })));
    const done = await importDeals('Deal,Company,Value,Won,Stage\nBig deal,acme corp,1200.50,yes,Won\nOrphan,Nowhere Inc,5,,\nAmbiguous,Twin,5,,\nNo company,,10,no,\n');
    assert.deepEqual(done.counts, { created: 2, updated: 0, skipped: 0, failed: 2 });
    const big = await RecordModel.findOne({ dataform: deals._id, 'data.title': 'Big deal' }).lean();
    assert.equal(String(big.data.company), acme._id, 'matched case-insensitively');
    assert.equal(big.data.value, 1200.5);
    assert.equal(big.data.won, true);
    assert.equal(big.data.stage, 'won');
    assert.equal((await RecordModel.findOne({ dataform: deals._id, 'data.title': 'No company' }).lean()).data.stage, 'qualified', 'defaults still apply');
    const msgs = Object.fromEntries(done.errors.map((e) => [e.row, e.message]));
    assert.equal(msgs[3], 'Company: No "Nowhere Inc" found in Firms');
    assert.equal(msgs[4], 'Company: More than one "Twin" exists in Firms');
  });

  it('runs before-save rules on every row, exactly like typing the record in', async () => {
    const rule = (await api('post', OWNER, '/workflows', {
      dataformId: deals._id, name: 'No free deals', description: '', trigger: { type: 'pre_save', events: ['create', 'update'] },
      conditions: { op: 'and', conditions: [{ kind: 'formula', expression: '{value} < 1' }] },
      actions: [{ type: 'validation_error', message: 'Deal "{{title}}" needs a value.' }],
    })).body.workflow;
    await api('patch', OWNER, `/workflows/${rule._id}/enabled`, { enabled: true }).expect(200);
    const done = await importDeals('Deal,Company,Value,Won,Stage\nPaid,,50,,\nFree,,0,,\n');
    assert.deepEqual(done.counts, { created: 1, updated: 0, skipped: 0, failed: 1 });
    assert.equal(done.errors[0].message, 'Deal "Free" needs a value.');
    await api('delete', OWNER, `/workflows/${rule._id}`).expect(204);
  });

  it('does not write anything when the import is cancelled before it starts running', async () => {
    const up = (await upload(OWNER, deals._id, 'Deal,Company,Value,Won,Stage\nNever,,1,,\n')).body.import;
    await api('post', OWNER, `/imports/${up._id}/start`, { mapping: MAP }).expect(202);
    const c = await api('post', OWNER, `/imports/${up._id}/cancel`);
    assert.equal(c.body.import.status, 'cancelled');
    await drain();
    assert.equal(await RecordModel.countDocuments({ dataform: deals._id, 'data.title': 'Never' }), 0);
    assert.equal((await api('post', OWNER, `/imports/${up._id}/cancel`)).status, 409);
    await api('delete', OWNER, `/imports/${up._id}`).expect(204);
    assert.equal((await api('get', OWNER, `/imports/${up._id}`)).status, 404);
  });
});

describe('interrupted imports', () => {
  it('resume from the last saved row instead of starting over', async () => {
    const up = (await upload(OWNER, contacts._id, 'Name\nResume A\nResume B\nResume C\n')).body.import;
    await api('post', OWNER, `/imports/${up._id}/start`, { mapping: [{ column: 0, field: 'name' }] }).expect(202);
    // Pretend a worker died after finishing the first row.
    await RecordModel.create({ account: ws.account, workspace: ws._id, dataform: contacts._id, data: { name: 'Resume A' } });
    await ImportJob.updateOne({ _id: up._id }, { $set: { status: 'running', processed: 1, 'counts.created': 1 } });
    const done = await wait(OWNER, up._id);
    assert.equal(done.status, 'done');
    assert.deepEqual(done.counts, { created: 3, updated: 0, skipped: 0, failed: 0 });
    assert.equal(await RecordModel.countDocuments({ dataform: contacts._id, 'data.name': 'Resume A' }), 1, 'the first row was not imported twice');
    assert.equal(await RecordModel.countDocuments({ dataform: contacts._id, 'data.name': /^Resume [BC]$/ }), 2);
  });
});

describe('exporting in the background', () => {
  const create = (who, body) => api('post', who, '/exports', body);
  const finish = async (who, id) => { await drain(); return (await api('get', who, `/exports/${id}`)).body.export; };
  const binary = (r, cb) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); };

  it('creates a CSV file with the same rules as the on-screen list', async () => {
    const fields = (await api('get', OWNER, `/dataforms/${contacts._id}`)).body.fields;
    await api('patch', OWNER, `/dataforms/${contacts._id}/fields/${fields.find((f) => f.key === 'phone')._id}`, { visibility: { list: false } }).expect(200);
    const res = await create(OWNER, { dataformId: contacts._id, columns: ['name', 'email', 'phone', 'tags'], sort: 'name:asc', filter: { op: 'and', conditions: [{ field: 'email', operator: 'notEmpty' }] } });
    assert.equal(res.status, 202, JSON.stringify(res.body));
    assert.equal(res.body.export.status, 'queued');
    assert.equal(res.body.export.storageKey, undefined);
    assert.equal((await api('get', OWNER, `/exports/${res.body.export._id}/download`)).status, 409, 'not ready yet');
    const job = await finish(OWNER, res.body.export._id);
    assert.equal(job.status, 'done', JSON.stringify(job));
    assert.equal(job.filename, `${contacts.slug}.csv`);
    const file = await api('get', OWNER, `/exports/${job._id}/download`);
    assert.equal(file.status, 200);
    assert.match(file.headers['content-disposition'], /attachment; filename="/);
    assert.equal(file.headers['x-content-type-options'], 'nosniff');
    const rows = parseCsv(file.text).rows;
    assert.deepEqual(rows[0], ['Full name', 'Email', 'Tags'], 'list-hidden Phone was left out');
    assert.equal(job.rowCount, rows.length - 1);
    assert.deepEqual(rows.slice(1).map((r) => r[0]), [...rows.slice(1).map((r) => r[0])].sort(), 'sorted by name');
    assert.equal(rows.find((r) => r[0] === 'Grace Hopper')[2], 'Newsletter', 'option labels, not stored values');
    assert.ok((await api('get', OWNER, '/notifications?limit=30')).body.data.some((n) => n.title.startsWith('Your export of')));
  });

  it('can bundle attachments into a zip next to the CSV', async () => {
    const rec = await RecordModel.findOne({ dataform: contacts._id, 'data.email': 'grace@imp.test' });
    for (const text of ['one', 'two']) {
      await request(app).post(`/api/v1/dataforms/${contacts._id}/records/${rec._id}/attachments`).set({ Authorization: `Bearer ${tokens[OWNER]}` }).attach('file', Buffer.from(text), { filename: 'notes.txt', contentType: 'text/plain' }).expect(201);
    }
    const res = await create(OWNER, { dataformId: contacts._id, format: 'zip', q: 'Grace' });
    const job = await finish(OWNER, res.body.export._id);
    assert.equal(job.status, 'done', JSON.stringify(job));
    assert.equal(job.fileCount, 2);
    assert.equal(job.filename, `${contacts.slug}-export.zip`);
    const file = await api('get', OWNER, `/exports/${job._id}/download`).buffer(true).parse(binary);
    assert.equal(file.headers['content-type'], 'application/zip');
    const text = file.body.toString('latin1');
    assert.ok(text.includes(`${contacts.slug}.csv`), 'csv is included');
    assert.match(text, /attachments\/Grace Hopper \([0-9a-f]{6}\)\/notes\.txt/);
    assert.match(text, /attachments\/Grace Hopper \([0-9a-f]{6}\)\/notes \(1\)\.txt/, 'same-named files do not overwrite each other');
  });

  it('is private to the person who asked and to their tenant', async () => {
    const res = await create(OWNER, { dataformId: contacts._id });
    const id = res.body.export._id;
    await drain();
    assert.equal((await api('get', GLOBEX, `/exports/${id}`)).status, 404);
    assert.equal((await api('get', GLOBEX, `/exports/${id}/download`)).status, 404);
    assert.equal((await api('get', MEMBER, `/exports/${id}`)).status, 404);
    assert.equal((await create(GLOBEX, { dataformId: contacts._id })).status, 404);
    assert.ok((await api('get', OWNER, `/exports?dataformId=${contacts._id}`)).body.data.length >= 3);
    assert.equal((await create(OWNER, { dataformId: contacts._id, filter: { op: 'and', conditions: [{ field: 'ghost', operator: 'eq', value: 1 }] } })).status, 400, 'a broken filter is refused up front');
    assert.equal((await create(OWNER, { dataformId: contacts._id, format: 'xlsx' })).status, 400);
    await api('delete', OWNER, `/exports/${id}`).expect(204);
  });

  it('removes old files and records during cleanup', async () => {
    const old = (await create(OWNER, { dataformId: contacts._id })).body.export;
    await drain();
    await ExportJob.updateOne({ _id: old._id }, { $set: { createdAt: new Date(Date.now() - 4 * 864e5) } });
    const stale = await ImportJob.findOne({ dataform: contacts._id }).select('_id');
    await ImportJob.updateOne({ _id: stale._id }, { $set: { createdAt: new Date(Date.now() - 31 * 864e5) } });
    const r = await purgeExpiredJobs();
    assert.ok(r.exports >= 1);
    assert.ok(r.imports >= 1);
    assert.equal(await ExportJob.countDocuments({ _id: old._id }), 0);
    assert.equal((await api('get', OWNER, `/exports/${old._id}/download`)).status, 404);
  });
});
