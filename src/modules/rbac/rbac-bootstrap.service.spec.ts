import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ConfigService } from '@/core/config/config.service';
import { User } from '@/modules/users/user.entity';
import { UserStatus } from '@/modules/users/user.types';
import { Grant } from './grant.entity';
import { GrantAction } from './grant-action.entity';
import { Permission } from './permission.entity';
import { PermissionAction } from './permission-action.entity';
import { RbacBootstrapService } from './rbac-bootstrap.service';
import { RbacPolicyState } from './rbac-policy-state.entity';
import { Role } from './role.entity';
import { UserRole } from './user-role.entity';

// The real decorator needs a DataSource; unit tests only check the service logic.
jest.mock('typeorm-transactional', () => ({
  Transactional: () => () => undefined,
}));

const ADMIN_ID = '7f1c2b4e-1111-4a6b-9c3d-000000000001';

/** A repository mock whose `save` gives every new row a readable id. */
function repositoryMock() {
  let counter = 0;
  const withId = <T extends object>(row: T) => ({
    id: `id-${++counter}`,
    ...row,
  });
  return {
    create: jest.fn(<T>(row: T) => row),
    save: jest.fn(<T extends object>(rows: T | T[]) =>
      Promise.resolve(Array.isArray(rows) ? rows.map(withId) : withId(rows)),
    ),
    insert: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue(false),
    existsBy: jest.fn().mockResolvedValue(true),
    findOne: jest.fn(),
    query: jest.fn().mockResolvedValue([]),
  };
}

type RepositoryMock = ReturnType<typeof repositoryMock>;

describe('RbacBootstrapService', () => {
  let service: RbacBootstrapService;
  let config: { get: jest.Mock };
  let users: RepositoryMock;
  let roles: RepositoryMock;
  let permissions: RepositoryMock;
  let permissionActions: RepositoryMock;
  let grants: RepositoryMock;
  let grantActions: RepositoryMock;
  let userRoles: RepositoryMock;
  let policyState: RepositoryMock;

  beforeEach(async () => {
    config = { get: jest.fn().mockReturnValue(ADMIN_ID) };
    users = repositoryMock();
    roles = repositoryMock();
    permissions = repositoryMock();
    permissionActions = repositoryMock();
    grants = repositoryMock();
    grantActions = repositoryMock();
    userRoles = repositoryMock();
    policyState = repositoryMock();
    policyState.findOne.mockResolvedValue({ id: 1, version: 0 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacBootstrapService,
        { provide: ConfigService, useValue: config },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: getRepositoryToken(Role), useValue: roles },
        { provide: getRepositoryToken(Permission), useValue: permissions },
        {
          provide: getRepositoryToken(PermissionAction),
          useValue: permissionActions,
        },
        { provide: getRepositoryToken(Grant), useValue: grants },
        { provide: getRepositoryToken(GrantAction), useValue: grantActions },
        { provide: getRepositoryToken(UserRole), useValue: userRoles },
        {
          provide: getRepositoryToken(RbacPolicyState),
          useValue: policyState,
        },
      ],
    }).compile();

    service = module.get(RbacBootstrapService);
  });

  /** The id the mocked `save` gave to the row with this name. */
  const savedIdByName = async (repository: RepositoryMock, name: string) => {
    const saved = await Promise.all(
      repository.save.mock.results.map(
        (result) => result.value as Promise<{ id: string; name: string }>,
      ),
    );
    return saved.find((row) => row.name === name)?.id;
  };

  it('locks the policy state row before deciding', async () => {
    await service.bootstrapIfEmpty();

    expect(policyState.findOne).toHaveBeenCalledWith({
      where: { id: 1 },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('fails loudly when the policy state row is missing', async () => {
    policyState.findOne.mockResolvedValue(null);

    await expect(service.bootstrapIfEmpty()).rejects.toThrow(
      'rbac_policy_state row is missing',
    );
  });

  it.each([
    ['roles', () => roles],
    ['permissions', () => permissions],
  ])('does nothing when %s already exist', async (_, repository) => {
    repository().exists.mockResolvedValue(true);

    await expect(service.bootstrapIfEmpty()).resolves.toEqual({
      status: 'already_initialized',
    });
    expect(permissions.save).not.toHaveBeenCalled();
    expect(userRoles.insert).not.toHaveBeenCalled();
    expect(policyState.update).not.toHaveBeenCalled();
  });

  it('skips everything when the admin id is not configured', async () => {
    config.get.mockReturnValue(undefined);

    await expect(service.bootstrapIfEmpty()).resolves.toEqual({
      status: 'skipped',
      reason: 'admin_not_configured',
    });
    expect(permissions.save).not.toHaveBeenCalled();
    expect(roles.save).not.toHaveBeenCalled();
  });

  it('skips everything when the admin user does not exist', async () => {
    users.existsBy.mockResolvedValue(false);

    await expect(service.bootstrapIfEmpty()).resolves.toEqual({
      status: 'skipped',
      reason: 'admin_not_found',
    });
    expect(users.existsBy).toHaveBeenCalledWith({ id: ADMIN_ID });
    expect(permissions.save).not.toHaveBeenCalled();
    expect(roles.save).not.toHaveBeenCalled();
  });

  describe('on an empty RBAC with an existing admin', () => {
    it('creates the three permissions with their actions', async () => {
      await service.bootstrapIfEmpty();

      const created = permissionActions.save.mock.calls.map(
        ([rows]: [{ name: string }[]]) => rows.map((row) => row.name),
      );
      expect(
        permissions.create.mock.calls.map(
          ([row]: [{ name: string }]) => row.name,
        ),
      ).toEqual(['rbac', 'users', 'transformations']);
      expect(created).toEqual([
        ['manage'],
        [
          'read',
          'read_any',
          'update',
          'update_any',
          'delete',
          'delete_any',
          'list',
        ],
        ['convert', 'history', 'history_any', 'download', 'download_any'],
      ]);
    });

    it('gives `user` explicit actions and `admin` all actions of users and transformations', async () => {
      await service.bootstrapIfEmpty();

      expect(
        roles.create.mock.calls.map(([row]: [{ name: string }]) => row.name),
      ).toEqual(['user', 'admin']);

      const allActionsFlags = grants.create.mock.calls.map(
        ([row]: [{ allActions: boolean }]) => row.allActions,
      );
      // user: users (explicit); admin: rbac (explicit), users, transformations
      expect(allActionsFlags).toEqual([false, false, true, true]);

      // Only the explicit grants get grant_actions rows: 3 for user, 1 for admin.
      const explicitCounts = grantActions.insert.mock.calls.map(
        ([rows]: [unknown[]]) => rows.length,
      );
      expect(explicitCounts).toEqual([3, 1]);
    });

    it('assigns `admin` to the configured user and `user` to active users without roles', async () => {
      userRoles.query.mockResolvedValue([{ user_id: 'a' }, { user_id: 'b' }]);

      const outcome = await service.bootstrapIfEmpty();

      const adminRoleId = await savedIdByName(roles, 'admin');
      const userRoleId = await savedIdByName(roles, 'user');
      expect(adminRoleId).toBeDefined();
      expect(userRoles.insert).toHaveBeenCalledWith({
        userId: ADMIN_ID,
        roleId: adminRoleId,
      });
      expect(userRoles.query).toHaveBeenCalledWith(
        expect.stringContaining('NOT EXISTS'),
        [userRoleId, UserStatus.ACTIVE],
      );
      expect(outcome).toEqual({
        status: 'initialized',
        adminUserId: ADMIN_ID,
        usersAssigned: 2,
        version: 1,
      });
    });

    it('increments the policy version', async () => {
      policyState.findOne.mockResolvedValue({ id: 1, version: 4 });

      await service.bootstrapIfEmpty();

      expect(policyState.update).toHaveBeenCalledWith(1, { version: 5 });
    });
  });

  describe('onModuleInit', () => {
    it('logs a warning when the bootstrap is skipped', async () => {
      config.get.mockReturnValue(undefined);
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      await service.onModuleInit();

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('reason=admin_not_configured'),
      );
    });
  });
});
