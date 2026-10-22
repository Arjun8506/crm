import { can } from '../../config/permissions.js';
import { forbidden, notFound } from '../../utils/errors.js';
import { Membership } from '../users/membership.model.js';
import { Workspace } from './workspace.model.js';

export const LEVEL = { viewer: 1, editor: 2, admin: 3 };
const WS_ROLE_LEVEL = { viewer: 1, editor: 2, admin: 3 };

// Of the given user ids, returns those who may open the workspace (active account member, and for private
// workspaces a listed member or an account admin). Used to validate mentions and task assignees.
export async function usersWithAccess(workspace, userIds) {
  const unique = [...new Set(userIds.map(String))].filter((id) => /^[a-f\d]{24}$/i.test(id));
  if (unique.length === 0) return [];
  const memberships = await Membership.find({ account: workspace.account, user: { $in: unique }, status: 'active' }).lean();
  const listed = new Set(workspace.members.map((m) => String(m.user)));
  return memberships
    .filter((m) => workspace.visibility !== 'private' || listed.has(String(m.user)) || can(m.role, 'workspace:admin'))
    .map((m) => String(m.user));
}

// Ids of every workspace in the caller's account that they may open (used for cross-workspace lists like My Tasks).
export async function accessibleWorkspaceIds(auth) {
  const filter = { account: auth.accountId };
  if (auth.apiKey?.workspaces?.length) filter._id = { $in: auth.apiKey.workspaces };
  if (!can(auth.role, 'workspace:admin')) filter.$or = [{ visibility: 'account' }, { 'members.user': auth.userId }];
  return (await Workspace.find(filter).select('_id').lean()).map((w) => w._id);
}

// Resolves the caller's effective level in a workspace (viewer < editor < admin).
// Unknown / invisible workspaces are reported as 404 so IDs cannot be probed across tenants.
export async function workspaceAccess(auth, workspaceId, minLevel = 'viewer') {
  // An API key limited to certain workspaces cannot see any other, and gets the same "not found" as a missing one.
  if (auth.apiKey?.workspaces?.length && !auth.apiKey.workspaces.includes(String(workspaceId))) throw notFound('Workspace not found');
  const workspace = await Workspace.findOne({ _id: workspaceId, account: auth.accountId });
  if (!workspace) throw notFound('Workspace not found');

  let level;
  if (can(auth.role, 'workspace:admin')) {
    level = LEVEL.admin;
  } else {
    const member = workspace.members.find((m) => String(m.user) === auth.userId);
    if (workspace.visibility === 'private' && !member) throw notFound('Workspace not found');
    level = member ? WS_ROLE_LEVEL[member.role] : (auth.role === 'viewer' ? LEVEL.viewer : LEVEL.editor);
    if (auth.role === 'viewer') level = Math.min(level, LEVEL.viewer);
  }
  if (level < LEVEL[minLevel]) throw forbidden();
  return { workspace, level, levelName: Object.keys(LEVEL).find((k) => LEVEL[k] === level) };
}
