// Account-level roles. Permissions are always resolved server-side from the Membership document.
export const ROLES = ['owner', 'admin', 'member', 'viewer'];

const PERMISSIONS = {
  owner: ['*'],
  admin: [
    'account:read', 'account:update', 'workspace:read', 'workspace:create', 'workspace:update',
    'workspace:delete', 'workspace:admin', 'user:read', 'user:manage',
  ],
  member: ['account:read', 'workspace:read', 'workspace:create', 'user:read'],
  viewer: ['account:read', 'workspace:read', 'user:read'],
};

export function can(role, permission) {
  const list = PERMISSIONS[role] || [];
  return list.includes('*') || list.includes(permission);
}

export const permissionsFor = (role) => (PERMISSIONS[role]?.includes('*') ? ['*'] : [...(PERMISSIONS[role] || [])]);
