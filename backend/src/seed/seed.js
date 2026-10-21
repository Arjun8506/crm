import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Account } from '../modules/accounts/account.model.js';
import { User } from '../modules/users/user.model.js';
import { Membership } from '../modules/users/membership.model.js';
import { Workspace } from '../modules/workspaces/workspace.model.js';
import { Session } from '../modules/auth/session.model.js';
import { hashPassword } from '../modules/auth/auth.service.js';
import { slugify } from '../utils/slug.js';

export const DEMO_PASSWORD = 'Passw0rd!demo';

const tenants = [
  {
    name: 'Acme Industries',
    plan: 'team',
    entitlements: { maxWorkspaces: 15, maxUsers: 50 },
    industry: 'Manufacturing',
    timezone: 'America/New_York',
    users: [
      { name: 'Alex Morgan', email: 'owner@acme.test', role: 'owner' },
      { name: 'Priya Nair', email: 'admin@acme.test', role: 'admin' },
      { name: 'Jordan Lee', email: 'member@acme.test', role: 'member' },
      { name: 'Sam Rivera', email: 'viewer@acme.test', role: 'viewer' },
      { name: 'Taylor Brooks', email: 'taylor@acme.test', role: 'member' },
    ],
    workspaces: [
      { name: 'Sales Pipeline', description: 'Leads, deals and customer accounts for the sales team.', color: '#4f46e5', visibility: 'account' },
      { name: 'Customer Support', description: 'Tickets, escalations and SLA tracking.', color: '#0891b2', visibility: 'account' },
      { name: 'Field Operations', description: 'Installations, site visits and technician scheduling.', color: '#059669', visibility: 'account' },
      { name: 'Executive Planning', description: 'Quarterly goals and board reporting. Restricted.', color: '#d97706', visibility: 'private', memberEmails: ['owner@acme.test', 'admin@acme.test'] },
    ],
  },
  {
    name: 'Globex Corporation',
    plan: 'free',
    industry: 'Logistics',
    timezone: 'Europe/London',
    users: [
      { name: 'Hannah Scott', email: 'owner@globex.test', role: 'owner' },
      { name: 'Marcus Webb', email: 'member@globex.test', role: 'member' },
    ],
    workspaces: [
      { name: 'Fleet Management', description: 'Vehicles, drivers and maintenance schedules.', color: '#dc2626', visibility: 'account' },
      { name: 'Client Onboarding', description: 'New customer setup and contracts.', color: '#7c3aed', visibility: 'account' },
    ],
  },
];

export async function seed() {
  await Promise.all([Account, User, Membership, Workspace, Session].map((m) => m.deleteMany({})));
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  for (const t of tenants) {
    const account = await Account.create({
      name: t.name,
      slug: slugify(t.name),
      plan: t.plan,
      ...(t.entitlements ? { entitlements: t.entitlements } : {}),
      settings: { industry: t.industry, timezone: t.timezone },
      onboarding: { completedAt: new Date() },
    });
    const byEmail = {};
    for (const u of t.users) {
      const user = await User.create({ name: u.name, email: u.email, passwordHash, emailVerified: true, defaultAccount: account._id });
      await Membership.create({ account: account._id, user: user._id, role: u.role });
      byEmail[u.email] = user;
    }
    const owner = byEmail[t.users[0].email];
    for (const w of t.workspaces) {
      const memberUsers = w.memberEmails ? w.memberEmails.map((e) => byEmail[e]) : t.users.slice(0, 4).map((u) => byEmail[u.email]);
      await Workspace.create({
        account: account._id,
        name: w.name,
        slug: slugify(w.name),
        description: w.description,
        color: w.color,
        visibility: w.visibility,
        createdBy: owner._id,
        members: memberUsers.filter(Boolean).map((u, i) => ({ user: u._id, role: i === 0 ? 'admin' : 'editor' })),
      });
    }
  }
}

// CLI: node src/seed/seed.js
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop())) {
  const isLocal = /^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(env.MONGO_URI);
  if (!isLocal && !process.argv.includes('--force')) {
    console.error('Refusing to seed: MONGO_URI is not a local database and seeding DELETES users, accounts, memberships, workspaces and sessions.');
    console.error('Re-run with:  npm run seed -- --force  if you really want that.');
    process.exit(1);
  }
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  await seed();
  await mongoose.syncIndexes();
  console.log('Seeded demo data. All demo users share the password:', DEMO_PASSWORD);
  console.log('  Acme (team plan):', tenants[0].users.map((u) => `${u.email} [${u.role}]`).join(', '));
  console.log('  Globex (free plan):', tenants[1].users.map((u) => `${u.email} [${u.role}]`).join(', '));
  await mongoose.disconnect();
}
