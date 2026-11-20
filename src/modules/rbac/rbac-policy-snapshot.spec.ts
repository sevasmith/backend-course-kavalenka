import {
  buildPolicySnapshot,
  RbacPolicyIntegrityError,
  RbacPolicyRows,
} from './rbac-policy-snapshot';

/** user: users@read (explicit); admin: users (all actions). */
function validRows(): RbacPolicyRows {
  return {
    version: 3,
    roles: [{ id: 'role-user' }, { id: 'role-admin' }],
    permissions: [{ id: 'perm-users', name: 'users' }],
    permissionActions: [
      { id: 'act-read', permissionId: 'perm-users', name: 'read' },
      { id: 'act-list', permissionId: 'perm-users', name: 'list' },
    ],
    grants: [
      {
        id: 'grant-user',
        roleId: 'role-user',
        permissionId: 'perm-users',
        allActions: false,
      },
      {
        id: 'grant-admin',
        roleId: 'role-admin',
        permissionId: 'perm-users',
        allActions: true,
      },
    ],
    grantActions: [{ grantId: 'grant-user', permissionActionId: 'act-read' }],
    userRoles: [
      { userId: 'alice', roleId: 'role-user' },
      { userId: 'alice', roleId: 'role-admin' },
    ],
  };
}

describe('buildPolicySnapshot', () => {
  it('builds lookups keyed for the access check', () => {
    const snapshot = buildPolicySnapshot(validRows());

    expect(snapshot.version).toBe(3);
    expect(snapshot.permissionActions.get('users')).toEqual(
      new Set(['read', 'list']),
    );
    expect(snapshot.roleGrants.get('role-user')?.get('users')).toEqual({
      allActions: false,
      actions: new Set(['read']),
    });
    expect(snapshot.roleGrants.get('role-admin')?.get('users')).toEqual({
      allActions: true,
      actions: new Set(),
    });
    expect(snapshot.userRoles.get('alice')).toEqual(
      new Set(['role-user', 'role-admin']),
    );
  });

  it('builds an empty policy', () => {
    const snapshot = buildPolicySnapshot({
      version: 0,
      roles: [],
      permissions: [],
      permissionActions: [],
      grants: [],
      grantActions: [],
      userRoles: [],
    });

    expect(snapshot.roleGrants.size).toBe(0);
    expect(snapshot.userRoles.size).toBe(0);
  });

  it.each<[string, (rows: RbacPolicyRows) => void]>([
    ['an explicit grant has no actions', (rows) => (rows.grantActions = [])],
    [
      'an all-actions grant also lists actions',
      (rows) =>
        rows.grantActions.push({
          grantId: 'grant-admin',
          permissionActionId: 'act-list',
        }),
    ],
    [
      'a grant lists an action of another permission',
      (rows) => {
        rows.permissions.push({ id: 'perm-rbac', name: 'rbac' });
        rows.permissionActions.push({
          id: 'act-manage',
          permissionId: 'perm-rbac',
          name: 'manage',
        });
        rows.grantActions.push({
          grantId: 'grant-user',
          permissionActionId: 'act-manage',
        });
      },
    ],
    [
      'a grant action points to a missing grant',
      (rows) =>
        rows.grantActions.push({
          grantId: 'missing',
          permissionActionId: 'act-read',
        }),
    ],
    [
      'a grant points to a missing role',
      (rows) => (rows.grants[0].roleId = 'missing'),
    ],
    [
      'a user has a missing role',
      (rows) => rows.userRoles.push({ userId: 'bob', roleId: 'missing' }),
    ],
    [
      'an action points to a missing permission',
      (rows) => (rows.permissionActions[1].permissionId = 'missing'),
    ],
  ])('rejects the policy when %s', (_, breakRows) => {
    const rows = validRows();
    breakRows(rows);

    expect(() => buildPolicySnapshot(rows)).toThrow(RbacPolicyIntegrityError);
  });
});
