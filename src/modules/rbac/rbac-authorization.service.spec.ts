import { Test, TestingModule } from '@nestjs/testing';

import {
  isAllowed,
  RbacAuthorizationService,
} from './rbac-authorization.service';
import {
  buildPolicySnapshot,
  RbacPolicySnapshot,
} from './rbac-policy-snapshot';
import {
  RbacPolicySnapshotService,
  RbacPolicyUnavailableError,
} from './rbac-policy-snapshot.service';

/**
 * Permissions: users (read, update, list), rbac (manage).
 * Roles: reader → users@read; editor → users@update;
 *        admin → users (all actions); empty → no grants.
 * Users: alice → reader + editor; bob → admin; carol → empty; dave → none.
 */
function snapshot(): RbacPolicySnapshot {
  return buildPolicySnapshot({
    version: 1,
    roles: [
      { id: 'reader' },
      { id: 'editor' },
      { id: 'admin' },
      { id: 'empty' },
    ],
    permissions: [
      { id: 'p-users', name: 'users' },
      { id: 'p-rbac', name: 'rbac' },
    ],
    permissionActions: [
      { id: 'a-read', permissionId: 'p-users', name: 'read' },
      { id: 'a-update', permissionId: 'p-users', name: 'update' },
      { id: 'a-list', permissionId: 'p-users', name: 'list' },
      { id: 'a-manage', permissionId: 'p-rbac', name: 'manage' },
    ],
    grants: [
      {
        id: 'g-reader',
        roleId: 'reader',
        permissionId: 'p-users',
        allActions: false,
      },
      {
        id: 'g-editor',
        roleId: 'editor',
        permissionId: 'p-users',
        allActions: false,
      },
      {
        id: 'g-admin',
        roleId: 'admin',
        permissionId: 'p-users',
        allActions: true,
      },
    ],
    grantActions: [
      { grantId: 'g-reader', permissionActionId: 'a-read' },
      { grantId: 'g-editor', permissionActionId: 'a-update' },
    ],
    userRoles: [
      { userId: 'alice', roleId: 'reader' },
      { userId: 'alice', roleId: 'editor' },
      { userId: 'bob', roleId: 'admin' },
      { userId: 'carol', roleId: 'empty' },
    ],
  });
}

describe('isAllowed', () => {
  const policy = snapshot();

  it('allows an action listed in an explicit grant', () => {
    expect(isAllowed(policy, 'alice', 'users', 'read')).toBe(true);
  });

  it('denies an action missing from an explicit grant', () => {
    expect(isAllowed(policy, 'alice', 'users', 'list')).toBe(false);
  });

  it('combines the grants of all the user roles', () => {
    // read comes from reader, update from editor.
    expect(isAllowed(policy, 'alice', 'users', 'update')).toBe(true);
  });

  it('allows every action of the permission with all actions', () => {
    expect(isAllowed(policy, 'bob', 'users', 'read')).toBe(true);
    expect(isAllowed(policy, 'bob', 'users', 'list')).toBe(true);
  });

  it('denies a permission the roles have no grant for', () => {
    expect(isAllowed(policy, 'bob', 'rbac', 'manage')).toBe(false);
  });

  it('denies an unknown action even with all actions', () => {
    expect(isAllowed(policy, 'bob', 'users', 'delete_any')).toBe(false);
  });

  it('denies an unknown permission', () => {
    expect(isAllowed(policy, 'bob', 'transformations', 'read')).toBe(false);
  });

  it('denies a user whose roles have no grants', () => {
    expect(isAllowed(policy, 'carol', 'users', 'read')).toBe(false);
  });

  it('denies a user without roles', () => {
    expect(isAllowed(policy, 'dave', 'users', 'read')).toBe(false);
  });
});

describe('RbacAuthorizationService', () => {
  let service: RbacAuthorizationService;
  let getCurrentSnapshot: jest.Mock;

  beforeEach(async () => {
    getCurrentSnapshot = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacAuthorizationService,
        {
          provide: RbacPolicySnapshotService,
          useValue: { getCurrentSnapshot },
        },
      ],
    }).compile();

    service = module.get(RbacAuthorizationService);
  });

  it('decides on the current snapshot', async () => {
    getCurrentSnapshot.mockResolvedValue(snapshot());

    await expect(service.authorize('alice', 'users', 'read')).resolves.toBe(
      true,
    );
    await expect(service.authorize('alice', 'users', 'list')).resolves.toBe(
      false,
    );
  });

  it('throws instead of denying when the policy is unavailable', async () => {
    getCurrentSnapshot.mockRejectedValue(new RbacPolicyUnavailableError());

    await expect(
      service.authorize('alice', 'users', 'read'),
    ).rejects.toBeInstanceOf(RbacPolicyUnavailableError);
  });
});
