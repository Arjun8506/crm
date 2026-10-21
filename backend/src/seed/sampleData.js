import { Dataform, FieldDefinition } from '../modules/dataforms/dataform.model.js';
import { addField } from '../modules/dataforms/dataform.service.js';
import { TEMPLATES } from '../modules/dataforms/templates.js';
import { RecordModel } from '../modules/records/record.model.js';
import { slugify } from '../utils/slug.js';
import { View } from '../modules/views/view.model.js';
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

export async function seedSampleData(account, workspaces, owner) {
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

export const clearSampleData = () => Promise.all([Dataform.deleteMany({}), FieldDefinition.deleteMany({}), RecordModel.deleteMany({}), View.deleteMany({}), Report.deleteMany({}), Dashboard.deleteMany({})]);
