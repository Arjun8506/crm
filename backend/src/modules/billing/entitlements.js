import { PLANS, PLAN_ORDER, isPlan } from '../../config/plans.js';
import { ApiError } from '../../utils/errors.js';
import { Account } from '../accounts/account.model.js';
import { RecordModel } from '../records/record.model.js';

// What an account may do: its plan's limits, with any per-account overrides applied on top.
export function entitlementsOf(account) {
  const plan = isPlan(account?.plan) ? account.plan : 'free';
  return { ...PLANS[plan].limits, ...(account?.entitlementOverrides ?? {}) };
}

export async function entitlementsFor(accountId) {
  const account = await Account.findById(accountId).select('plan entitlementOverrides').lean();
  return entitlementsOf(account);
}

// 402 Payment Required: the action needs a different plan. `upgradeTo` is the cheapest plan that would allow it.
export class PlanLimitError extends ApiError {
  constructor(message, { limit, plan } = {}) {
    super(402, 'PLAN_LIMIT', message, limit ? [{ path: limit, message }] : undefined);
    this.limit = limit;
    this.plan = plan;
  }
}

export function cheapestPlanWith(limit, test = Boolean) {
  return PLAN_ORDER.find((id) => test(PLANS[id].limits[limit]));
}

// Throws unless the account's plan includes a yes/no feature.
export async function requireFeature(accountId, limit, what) {
  const e = await entitlementsFor(accountId);
  if (!e[limit]) {
    const plan = cheapestPlanWith(limit);
    throw new PlanLimitError(`${what} ${plan ? `are included from the ${PLANS[plan].name} plan` : 'are not available'}. Upgrade under Billing to use them.`, { limit });
  }
}

export async function featureEnabled(accountId, limit) {
  return !!(await entitlementsFor(accountId))[limit];
}

// Records count against the plan's total. `adding` lets bulk operations check once instead of once per record.
export async function recordRoom(accountId) {
  const [{ maxRecords }, used] = await Promise.all([entitlementsFor(accountId), RecordModel.countDocuments({ account: accountId })]);
  return { limit: maxRecords, used, room: Math.max(0, maxRecords - used) };
}

export const recordLimitError = (limit) => new PlanLimitError(`Your plan allows up to ${limit.toLocaleString('en-US')} records. Upgrade under Billing to add more, or delete records you no longer need.`, { limit: 'maxRecords' });

export async function assertRecordCapacity(accountId, adding = 1) {
  const { limit, room } = await recordRoom(accountId);
  if (room < adding) throw recordLimitError(limit);
}
