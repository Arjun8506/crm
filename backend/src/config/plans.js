// Pricing plans and what each one includes. Prices are in cents per month (USD).
// Limits are enforced when something is CREATED; existing data is never deleted when a plan is downgraded.

export const PLAN_ORDER = ['free', 'team', 'business'];

export const PLANS = {
  free: {
    id: 'free', name: 'Free', priceMonthly: 0, blurb: 'For trying things out with a small team.',
    limits: { maxWorkspaces: 5, maxUsers: 10, maxUploadMb: 25, maxRecords: 5000, locationFields: false, apiAccess: false, publicPages: false, aiRequestsPerMonth: 0 },
  },
  team: {
    id: 'team', name: 'Team', priceMonthly: 2900, blurb: 'For growing teams that automate and integrate.',
    limits: { maxWorkspaces: 15, maxUsers: 50, maxUploadMb: 100, maxRecords: 100000, locationFields: true, apiAccess: true, publicPages: true, aiRequestsPerMonth: 200 },
  },
  business: {
    id: 'business', name: 'Business', priceMonthly: 9900, blurb: 'For organisations that need more room and AI assistance.',
    limits: { maxWorkspaces: 100, maxUsers: 500, maxUploadMb: 500, maxRecords: 1000000, locationFields: true, apiAccess: true, publicPages: true, aiRequestsPerMonth: 2000 },
  },
};

export const isPlan = (id) => Object.hasOwn(PLANS, id);
export const rank = (id) => PLAN_ORDER.indexOf(id);

// Human wording for each limit, used in upgrade prompts and the plan comparison.
export const LIMIT_LABELS = {
  maxWorkspaces: 'Workspaces', maxUsers: 'Team members', maxUploadMb: 'Largest file (MB)', maxRecords: 'Records', locationFields: 'Location fields and map view',
  apiAccess: 'API keys and webhooks', publicPages: 'Public forms and shared links', aiRequestsPerMonth: 'AI requests per month',
};
