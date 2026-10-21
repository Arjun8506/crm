import { Dataform, FieldDefinition } from '../modules/dataforms/dataform.model.js';
import { addField } from '../modules/dataforms/dataform.service.js';
import { TEMPLATES } from '../modules/dataforms/templates.js';
import { RecordModel } from '../modules/records/record.model.js';
import { slugify } from '../utils/slug.js';
import { View } from '../modules/views/view.model.js';
import { Comment, Follow } from '../modules/comments/comment.model.js';
import { Notification } from '../modules/notifications/notification.model.js';
import { Task, TaskActivity } from '../modules/tasks/task.model.js';
import { Dashboard, Report } from '../modules/analytics/report.model.js';

// Deterministic pseudo-random so every seed produces the same demo data.
let seedState = 42;
const rnd = () => { seedState = (seedState * 1664525 + 1013904223) % 4294967296; return seedState / 4294967296; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const day = (offset) => new Date(Date.UTC(2026, 9, 20) + offset * 864e5).toISOString().slice(0, 10);

const COMPANIES = [
  ['Northwind Traders', 'retail', 'https://northwind.example.com', 240], ['Initech', 'technology', 'https://initech.example.com', 1200],
  ['Umbrella Health', 'healthcare', 'https://umbrella.example.com', 5400], ['Hooli', 'technology', 'https://hooli.example.com', 18000],
  ['Stark Manufacturing', 'manufacturing', 'https://stark.example.com', 3100], ['Wayne Finance', 'finance', 'https://wayne.example.com', 900],
  ['Soylent Foods', 'retail', 'https://soylent.example.com', 410], ['Cyberdyne Systems', 'technology', 'https://cyberdyne.example.com', 760],
  ['Wonka Industries', 'manufacturing', 'https://wonka.example.com', 2200], ['Pied Piper', 'technology', 'https://piedpiper.example.com', 35],
  ['Vandelay Imports', 'other', 'https://vandelay.example.com', 12], ['Gringotts Bank', 'finance', 'https://gringotts.example.com', 640],
];
const CITIES = [
  [41.88, -87.63], [37.77, -122.42], [42.36, -71.06], [37.39, -122.08], [42.33, -83.05], [40.71, -74.0],
  [47.61, -122.33], [30.27, -97.74], [39.95, -75.17], [34.05, -118.24], [33.75, -84.39], [51.51, -0.13],
];
const FIRST = ['Olivia', 'Liam', 'Emma', 'Noah', 'Ava', 'Ethan', 'Sophia', 'Mason', 'Isabella', 'Lucas', 'Mia', 'Logan', 'Amelia', 'James'];
const LAST = ['Smith', 'Johnson', 'Brown', 'Taylor', 'Anderson', 'Thomas', 'Jackson', 'White', 'Harris', 'Martin', 'Garcia', 'Clark'];
const STATUSES = ['lead', 'prospect', 'customer', 'customer', 'churned'];
const STAGES = ['qualified', 'proposal', 'negotiation', 'won', 'lost'];

async function makeForm(account, workspace, owner, templateId) {
  const t = TEMPLATES.find((x) => x.id === templateId);
  const dataform = await Dataform.create({
    account: account._id, workspace: workspace._id, name: t.name, slug: slugify(t.name), description: t.description,
    category: t.category, createdBy: owner._id,
  });
  for (const f of t.fields) await addField(dataform, f);
  return dataform;
}

export async function seedSampleData(account, workspaces, owner, users = {}) {
  const sales = workspaces.find((w) => w.name === 'Sales Pipeline');
  const support = workspaces.find((w) => w.name === 'Customer Support');
  const base = { account: account._id, createdBy: owner._id, updatedBy: owner._id };

  const companies = await makeForm(account, sales, owner, 'companies');
  const contacts = await makeForm(account, sales, owner, 'contacts');
  const deals = await makeForm(account, sales, owner, 'deals');
  const link = (df, target) => addField(df, {
    key: 'company', label: 'Company', type: 'relationship', config: { targetDataform: target._id }, section: 'General',
  });
  await link(contacts, companies);
  await link(deals, companies);

  await addField(companies, { key: 'hq', label: 'Headquarters', type: 'location', description: 'Used by the map view' });
  const companyDocs = await RecordModel.insertMany(COMPANIES.map(([name, industry, website, employees], i) => ({
    ...base, workspace: sales._id, dataform: companies._id,
    data: { name, industry, website, employees, hq: { lat: CITIES[i][0], lng: CITIES[i][1] } },
  })));

  const contactRows = [];
  for (let i = 0; i < 40; i++) {
    const first = pick(FIRST); const last = pick(LAST);
    contactRows.push({
      ...base, workspace: sales._id, dataform: contacts._id,
      data: {
        name: `${first} ${last}`, email: `${first}.${last}${i}@example.com`.toLowerCase(), phone: `+1 555 01${String(i).padStart(2, '0')}`,
        status: pick(STATUSES), tags: rnd() > 0.7 ? ['vip'] : [], last_contacted: day(-Math.floor(rnd() * 120)), company: pick(companyDocs)._id,
      },
    });
  }
  await RecordModel.insertMany(contactRows);

  const dealRows = [];
  const dealNames = ['Platform licence', 'Annual support', 'Onboarding package', 'Hardware refresh', 'Pilot programme', 'Expansion', 'Renewal'];
  for (let i = 0; i < 28; i++) {
    const co = pick(companyDocs);
    const stage = pick(STAGES);
    dealRows.push({
      ...base, workspace: sales._id, dataform: deals._id,
      data: {
        title: `${co.data.name}: ${pick(dealNames)}`, value: Math.round(rnd() * 90000 + 2000), stage,
        close_date: day(Math.floor(rnd() * 150) - 40), won: stage === 'won', company: co._id,
      },
    });
  }
  await RecordModel.insertMany(dealRows);

  const viewBase = { account: account._id, owner: owner._id, shared: true };
  await View.insertMany([
    { ...viewBase, dataform: deals._id, name: 'Deal pipeline', type: 'kanban', config: { groupField: 'stage', cardFields: ['value', 'close_date'] } },
    { ...viewBase, dataform: deals._id, name: 'Closing calendar', type: 'calendar', config: { dateField: 'close_date' } },
    { ...viewBase, dataform: contacts._id, name: 'Customers', type: 'table', config: { filter: { op: 'and', conditions: [{ field: 'status', operator: 'eq', value: 'customer' }] }, sort: 'name:asc' } },
    { ...viewBase, dataform: contacts._id, name: 'Contact cards', type: 'cards', config: { cardFields: ['email', 'status', 'company'] } },
    { ...viewBase, dataform: companies._id, name: 'Company map', type: 'map', config: { locationField: 'hq' } },
  ]);

  const repBase = { account: account._id, workspace: sales._id, owner: owner._id, shared: true };
  const openDeals = { op: 'and', conditions: [{ field: 'stage', operator: 'notIn', value: ['won', 'lost'] }] };
  const reports = await Report.insertMany([
    { ...repBase, dataform: deals._id, name: 'Pipeline value by stage', description: 'Deal count and total value for each stage.', kind: 'analyzer', config: { groupBy: [{ field: 'stage' }], metrics: [{ op: 'count' }, { op: 'sum', field: 'value' }, { op: 'avg', field: 'value' }] } },
    { ...repBase, dataform: deals._id, name: 'Deals closing by month', kind: 'analyzer', config: { groupBy: [{ field: 'close_date', interval: 'month' }, { field: 'stage' }], metrics: [{ op: 'count' }, { op: 'sum', field: 'value' }] } },
    { ...repBase, dataform: deals._id, name: 'Open deals (largest first)', kind: 'list', config: { columns: ['title', 'company', 'value', 'stage', 'close_date'], filter: openDeals, sort: 'value:desc' } },
  ]);

  const w = (type, title, wd, h, config) => ({ id: `w_${title.toLowerCase().replace(/[^a-z]+/g, '_')}`, type, title, w: wd, h, config });
  await Dashboard.create({
    account: account._id, owner: owner._id, scope: 'account', name: 'Sales overview',
    widgets: [
      w('kpi', 'Open pipeline value', 4, 1, { dataformId: String(deals._id), metric: { op: 'sum', field: 'value' }, filter: openDeals }),
      w('kpi', 'Open deals', 4, 1, { dataformId: String(deals._id), metric: { op: 'count' }, filter: openDeals }),
      w('kpi', 'Contacts', 4, 1, { dataformId: String(contacts._id), metric: { op: 'count' } }),
      w('chart', 'Deal value by stage', 6, 2, { dataformId: String(deals._id), chart: 'bar', groupBy: { field: 'stage' }, metric: { op: 'sum', field: 'value' }, limit: 12 }),
      w('chart', 'Contacts by status', 6, 2, { dataformId: String(contacts._id), chart: 'pie', groupBy: { field: 'status' }, metric: { op: 'count' }, limit: 12 }),
      w('chart', 'Deals closing per month', 8, 2, { dataformId: String(deals._id), chart: 'line', groupBy: { field: 'close_date', interval: 'month' }, metric: { op: 'count' }, limit: 12 }),
      w('report', 'Largest open deals', 12, 2, { reportId: String(reports[2]._id) }),
      w('list', 'Newest contacts', 6, 2, { dataformId: String(contacts._id), sort: 'createdAt:desc', columns: ['name', 'status', 'company'], limit: 6 }),
    ],
  });

  await seedCollaboration({ account, sales, owner, users, deals, contacts });

  const tickets = await makeForm(account, support, owner, 'tickets');
  const subjects = ['Cannot log in', 'Invoice discrepancy', 'Feature request: export', 'Slow dashboard', 'Password reset loop', 'Data import failed'];
  await RecordModel.insertMany(Array.from({ length: 18 }, (_, i) => ({
    ...base, workspace: support._id, dataform: tickets._id,
    data: {
      subject: `${pick(subjects)} #${100 + i}`, priority: pick(['low', 'medium', 'high', 'urgent']), status: pick(['open', 'in_progress', 'resolved']),
      description: 'Reported by customer via email. Needs triage.', opened_at: new Date(Date.UTC(2026, 9, 20) - Math.floor(rnd() * 30) * 864e5),
    },
  })));
}

export const clearSampleData = () => Promise.all([Comment.deleteMany({}), Follow.deleteMany({}), Task.deleteMany({}), TaskActivity.deleteMany({}), Notification.deleteMany({}), Dataform.deleteMany({}), FieldDefinition.deleteMany({}), RecordModel.deleteMany({}), View.deleteMany({}), Report.deleteMany({}), Dashboard.deleteMany({})]);

// Comments, tasks and notifications so the collaboration UI has something to show. Dates are relative to "now".
async function seedCollaboration({ account, sales, owner, users, deals, contacts }) {
  const person = (email) => users[email] ?? owner;
  const alex = owner; const priya = person('admin@acme.test'); const jordan = person('member@acme.test'); const taylor = person('taylor@acme.test');
  const now = Date.now();
  const inDays = (d, hour = 17) => { const x = new Date(now + d * 864e5); x.setUTCHours(hour, 0, 0, 0); return x; };

  const dealRecs = await RecordModel.find({ account: account._id, dataform: deals._id }).sort({ rank: 1 }).limit(3).lean();
  const contactRecs = await RecordModel.find({ account: account._id, dataform: contacts._id }).sort({ rank: 1 }).limit(2).lean();
  const target = (df, r) => ({ account: account._id, workspace: sales._id, dataform: df._id, record: r._id });

  const root1 = await Comment.create({ ...target(deals, dealRecs[0]), author: jordan._id, body: 'Customer asked for revised pricing before Friday. Can finance sign off on a 10% discount?', mentions: [priya._id], createdAt: inDays(-2, 9) });
  await Comment.create({ ...target(deals, dealRecs[0]), author: priya._id, parent: root1._id, body: 'Approved up to 8%. Anything beyond that needs Alex.', mentions: [], createdAt: inDays(-2, 11) });
  await Comment.create({ ...target(deals, dealRecs[0]), author: alex._id, parent: root1._id, body: 'Fine by me. Please send the updated quote today.', mentions: [jordan._id], createdAt: inDays(-1, 8) });
  await Comment.create({ ...target(deals, dealRecs[1]), author: taylor._id, body: 'Legal flagged one clause in the draft contract. I will follow up on Monday.', mentions: [], createdAt: inDays(-1, 14) });
  await Comment.create({ ...target(contacts, contactRecs[0]), author: alex._id, body: 'Met at the trade show: very interested in the annual plan. @Taylor can you take this one?', mentions: [taylor._id], createdAt: inDays(-3, 10) });

  const follow = (df, r, ...us) => Follow.insertMany(us.map((u) => ({ ...target(df, r), user: u._id, reason: 'auto' })));
  await follow(deals, dealRecs[0], jordan, priya, alex);
  await follow(deals, dealRecs[1], taylor, alex);
  await follow(contacts, contactRecs[0], alex, taylor);

  const task = (title, who, due, extra = {}) => Task.create({
    account: account._id, workspace: sales._id, title, assignees: who.map((u) => u._id), createdBy: alex._id, due, ...extra,
  });
  const tasks = [
    await task('Send revised quote to customer', [jordan], inDays(-1), { priority: 'urgent', dataform: deals._id, record: dealRecs[0]._id, description: 'Include the approved 8% discount and updated payment terms.' }),
    await task('Review legal comments on contract', [taylor, jordan], inDays(0, 23), { priority: 'high', status: 'in_progress', dataform: deals._id, record: dealRecs[1]._id }),
    await task('Follow up with trade-show lead', [taylor], inDays(2), { dataform: contacts._id, record: contactRecs[0]._id, reminderAt: inDays(1, 9) }),
    await task('Prepare Q4 pipeline review', [jordan, priya], inDays(6), { priority: 'normal' }),
    await task('Update CRM data quality checklist', [jordan], undefined, { priority: 'low' }),
    await task('Onboard new account executive', [priya], inDays(-4), { status: 'done', completedAt: inDays(-3) }),
  ];
  await TaskActivity.insertMany(tasks.map((t) => ({ account: account._id, task: t._id, user: alex._id, action: 'create', at: inDays(-5) })));
  await Comment.create({ account: account._id, workspace: sales._id, task: tasks[0]._id, author: priya._id, body: 'Quote template is in the shared drive. Use the 2026 version.', mentions: [], createdAt: inDays(-1, 15) });

  const note = (user, type, title, body, link, ago) => ({ account: account._id, user: user._id, actor: alex._id, type, title, body, link, createdAt: new Date(now - ago * 36e5) });
  await Notification.insertMany([
    note(jordan, 'task_assigned', 'You were assigned: Send revised quote to customer', 'Due yesterday', `/tasks?task=${tasks[0]._id}`, 30),
    note(jordan, 'mention', 'Alex Morgan mentioned you on a deal', 'Fine by me. Please send the updated quote today.', `/w/${sales._id}/f/${deals._id}?record=${dealRecs[0]._id}`, 20),
    note(jordan, 'task_overdue', 'Overdue: Send revised quote to customer', '', `/tasks?task=${tasks[0]._id}`, 2),
    note(taylor, 'mention', 'Alex Morgan mentioned you on a contact', 'Met at the trade show: very interested in the annual plan.', `/w/${sales._id}/f/${contacts._id}?record=${contactRecs[0]._id}`, 72),
    note(priya, 'comment', 'Jordan Lee commented on a deal', 'Customer asked for revised pricing before Friday.', `/w/${sales._id}/f/${deals._id}?record=${dealRecs[0]._id}`, 50),
  ]);

}
