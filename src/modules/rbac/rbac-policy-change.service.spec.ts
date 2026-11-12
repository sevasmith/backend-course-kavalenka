import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  hasRbacManager,
  RbacManageInvariantError,
  RbacPolicyChangeService,
} from './rbac-policy-change.service';
import {
  buildPolicySnapshot,
  RbacPolicyIntegrityError,
  RbacPolicyRows,
} from './rbac-policy-snapshot';
import { RbacPolicySnapshotService } from './rbac-policy-snapshot.service';
import { RbacPolicyState } from './rbac-policy-state.entity';

// The real decorator needs a DataSource; the rollback itself is a DB feature
// and is covered by integration tests (task 18). Here: the order of steps and
// that the version is not bumped when the change is rejected.
jest.mock('typeorm-transactional', () => ({
  Transactional: () => () => undefined,
  IsolationLevel: { REPEATABLE_READ: 'REPEATABLE READ' },
}));

/** `admin` has `rbac@manage` (explicit), `user` has only `users@read`. */
const policyRows = (
  userRoles: RbacPolicyRows['userRoles'],
  adminGrant: 'explicit' | 'all' = 'explicit',
): RbacPolicyRows => ({
  version: 5,
  roles: [{ id: 'role-admin' }, { id: 'role-user' }],
  permissions: [
    { id: 'perm-rbac', name: 'rbac' },
    { id: 'perm-users', name: 'users' },
  ],
  permissionActions: [
    { id: 'act-manage', permissionId: 'perm-rbac', name: 'manage' },
    { id: 'act-read', permissionId: 'perm-users', name: 'read' },
  ],
  grants: [
    {
      id: 'grant-admin',
      roleId: 'role-admin',
      permissionId: 'perm-rbac',
      allActions: adminGrant === 'all',
    },
    {
      id: 'grant-user',
      roleId: 'role-user',
      permissionId: 'perm-users',
      allActions: false,
    },
  ],
  grantActions: [
    ...(adminGrant === 'explicit'
      ? [{ grantId: 'grant-admin', permissionActionId: 'act-manage' }]
      : []),
    { grantId: 'grant-user', permissionActionId: 'act-read' },
  ],
  userRoles,
});

const ADMIN = { userId: 'alice', roleId: 'role-admin' };
const USER = { userId: 'bob', roleId: 'role-user' };

describe('hasRbacManager', () => {
  it('is true when a user has rbac@manage through an explicit grant', () => {
    expect(hasRbacManager(buildPolicySnapshot(policyRows([ADMIN, USER])))).toBe(
      true,
    );
  });

  it('is true when a user has rbac@manage through an all-actions grant', () => {
    expect(
      hasRbacManager(buildPolicySnapshot(policyRows([ADMIN], 'all'))),
    ).toBe(true);
  });

  it('is false when no user has rbac@manage', () => {
    expect(hasRbacManager(buildPolicySnapshot(policyRows([USER])))).toBe(false);
  });

  it('is false when nobody has roles', () => {
    expect(hasRbacManager(buildPolicySnapshot(policyRows([])))).toBe(false);
  });
});

describe('RbacPolicyChangeService', () => {
  let service: RbacPolicyChangeService;
  let policyState: { findOne: jest.Mock; update: jest.Mock };
  let snapshotService: { readPolicyRows: jest.Mock };
  let calls: string[];
  let change: jest.Mock;

  beforeEach(async () => {
    calls = [];
    change = jest.fn().mockImplementation(() => {
      calls.push('change');
      return Promise.resolve('created');
    });
    policyState = {
      findOne: jest.fn().mockImplementation(() => {
        calls.push('lock');
        return Promise.resolve({ id: 1, version: 5 });
      }),
      update: jest.fn().mockImplementation(() => {
        calls.push('bump');
        return Promise.resolve();
      }),
    };
    snapshotService = {
      readPolicyRows: jest.fn().mockImplementation(() => {
        calls.push('read');
        return Promise.resolve(policyRows([ADMIN, USER]));
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacPolicyChangeService,
        { provide: RbacPolicySnapshotService, useValue: snapshotService },
        {
          provide: getRepositoryToken(RbacPolicyState),
          useValue: policyState,
        },
      ],
    }).compile();

    service = module.get(RbacPolicyChangeService);
  });

  it('locks, changes, checks, then bumps the version by one', async () => {
    await expect(service.apply(change)).resolves.toEqual({
      result: 'created',
      version: 6,
    });

    expect(calls).toEqual(['lock', 'change', 'read', 'bump']);
    expect(policyState.findOne).toHaveBeenCalledWith({
      where: { id: 1 },
      lock: { mode: 'pessimistic_write' },
    });
    expect(policyState.update).toHaveBeenCalledWith(1, { version: 6 });
  });

  it('rejects a change that leaves no user with rbac@manage', async () => {
    snapshotService.readPolicyRows.mockResolvedValue(policyRows([USER]));

    await expect(service.apply(change)).rejects.toThrow(
      RbacManageInvariantError,
    );
    expect(policyState.update).not.toHaveBeenCalled();
  });

  it('rejects a change that breaks the policy graph', async () => {
    snapshotService.readPolicyRows.mockResolvedValue(
      policyRows([{ userId: 'alice', roleId: 'role-missing' }]),
    );

    await expect(service.apply(change)).rejects.toThrow(
      RbacPolicyIntegrityError,
    );
    expect(policyState.update).not.toHaveBeenCalled();
  });

  it('does not bump the version when the change fails', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('unique violation'));

    await expect(service.apply(failing)).rejects.toThrow('unique violation');
    expect(snapshotService.readPolicyRows).not.toHaveBeenCalled();
    expect(policyState.update).not.toHaveBeenCalled();
  });

  it('fails without running the change when the state row is missing', async () => {
    policyState.findOne.mockResolvedValue(null);

    await expect(service.apply(change)).rejects.toThrow(
      'rbac_policy_state row is missing',
    );
    expect(change).not.toHaveBeenCalled();
  });
});
