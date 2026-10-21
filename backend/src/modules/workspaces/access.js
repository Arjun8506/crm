import { can } from '../../config/permissions.js';
import { forbidden, notFound } from '../../utils/errors.js';
import { Workspace } from './workspace.model.js';

export const LEVEL = { viewer: 1, editor: 2, admin: 3 };
const WS_ROLE_LEVEL = { viewer: 1, editor: 2, admin: 3 };

// Resolves the caller's effective level in a workspace (viewer < editor < admin).
// Unknown / invisible workspaces are reported as 404 so IDs cannot be probed across tenants.
export async function workspaceAccess(auth, workspaceId, minLevel = 'viewer') {
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
