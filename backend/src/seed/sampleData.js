import { Dataform, FieldDefinition } from '../modules/dataforms/dataform.model.js';
import { addField } from '../modules/dataforms/dataform.service.js';
import { TEMPLATES } from '../modules/dataforms/templates.js';
import { RecordModel } from '../modules/records/record.model.js';
import { slugify } from '../utils/slug.js';

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

  const companyDocs = await RecordModel.insertMany(COMPANIES.map(([name, industry, website, employees]) => ({
    ...base, workspace: sales._id, dataform: companies._id, data: { name, industry, website, employees },
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

export const clearSampleData = () => Promise.all([Dataform.deleteMany({}), FieldDefinition.deleteMany({}), RecordModel.deleteMany({})]);
