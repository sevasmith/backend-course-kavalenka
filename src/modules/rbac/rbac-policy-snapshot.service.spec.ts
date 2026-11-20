import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Grant } from './grant.entity';
import { GrantAction } from './grant-action.entity';
import { Permission } from './permission.entity';
import { PermissionAction } from './permission-action.entity';
import {
  RbacPolicySnapshotService,
  RbacPolicyUnavailableError,
} from './rbac-policy-snapshot.service';
import { RbacPolicyState } from './rbac-policy-state.entity';
import { Role } from './role.entity';
import { UserRole } from './user-role.entity';

// The real decorator needs a DataSource; unit tests only check the service logic.
jest.mock('typeorm-transactional', () => ({
  Transactional: () => () => undefined,
  IsolationLevel: { REPEATABLE_READ: 'REPEATABLE READ' },
}));

const repositoryMock = () => ({
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn(),
});

type RepositoryMock = ReturnType<typeof repositoryMock>;

describe('RbacPolicySnapshotService', () => {
  let service: RbacPolicySnapshotService;
  let roles: RepositoryMock;
  let policyState: RepositoryMock;
  let dbVersion: number;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    roles = repositoryMock();
    policyState = repositoryMock();
    dbVersion = 1;
    policyState.findOne.mockImplementation(() =>
      Promise.resolve({ version: dbVersion }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacPolicySnapshotService,
        { provide: getRepositoryToken(Role), useValue: roles },
        { provide: getRepositoryToken(Permission), useValue: repositoryMock() },
        {
          provide: getRepositoryToken(PermissionAction),
          useValue: repositoryMock(),
        },
        { provide: getRepositoryToken(Grant), useValue: repositoryMock() },
        {
          provide: getRepositoryToken(GrantAction),
          useValue: repositoryMock(),
        },
        { provide: getRepositoryToken(UserRole), useValue: repositoryMock() },
        {
          provide: getRepositoryToken(RbacPolicyState),
          useValue: policyState,
        },
      ],
    }).compile();

    service = module.get(RbacPolicySnapshotService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('is not loaded before the first load', () => {
    expect(service.isLoaded()).toBe(false);
  });

  it('loads the snapshot at startup', async () => {
    await service.onApplicationBootstrap();

    expect(service.isLoaded()).toBe(true);
    expect(roles.find).toHaveBeenCalledTimes(1);
  });

  it('does not stop the app when the startup load fails', async () => {
    roles.find.mockRejectedValue(new Error('connection lost'));

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(service.isLoaded()).toBe(false);
  });

  it('reuses the snapshot while the version is the same', async () => {
    await service.onApplicationBootstrap();

    const first = await service.getCurrentSnapshot();
    const second = await service.getCurrentSnapshot();

    expect(second).toBe(first);
    expect(roles.find).toHaveBeenCalledTimes(1);
  });

  it('reloads and replaces the snapshot when the version changes', async () => {
    await service.onApplicationBootstrap();
    const old = await service.getCurrentSnapshot();

    dbVersion = 2;
    const current = await service.getCurrentSnapshot();

    expect(current).not.toBe(old);
    expect(current.version).toBe(2);
    expect(roles.find).toHaveBeenCalledTimes(2);
  });

  it('runs one reload for parallel checks', async () => {
    await service.onApplicationBootstrap();
    dbVersion = 2;

    const results = await Promise.all([
      service.getCurrentSnapshot(),
      service.getCurrentSnapshot(),
      service.getCurrentSnapshot(),
    ]);

    expect(new Set(results).size).toBe(1);
    expect(roles.find).toHaveBeenCalledTimes(2);
  });

  it('drops the old snapshot and throws when a reload fails', async () => {
    await service.onApplicationBootstrap();
    dbVersion = 2;
    roles.find.mockRejectedValue(new Error('connection lost'));

    await expect(service.getCurrentSnapshot()).rejects.toBeInstanceOf(
      RbacPolicyUnavailableError,
    );
    expect(service.isLoaded()).toBe(false);
  });

  it('throws when the policy is invalid', async () => {
    // A role assignment that points to no role.
    roles.find.mockResolvedValue([]);
    const userRoles = (
      service as unknown as { userRolesRepository: RepositoryMock }
    ).userRolesRepository;
    userRoles.find.mockResolvedValue([{ userId: 'u', roleId: 'missing' }]);

    await expect(service.getCurrentSnapshot()).rejects.toBeInstanceOf(
      RbacPolicyUnavailableError,
    );
    expect(service.isLoaded()).toBe(false);
  });

  it('recovers on the next check once the load works again', async () => {
    roles.find.mockRejectedValueOnce(new Error('connection lost'));
    await service.onApplicationBootstrap();

    await expect(service.getCurrentSnapshot()).resolves.toMatchObject({
      version: 1,
    });
    expect(service.isLoaded()).toBe(true);
  });

  it('throws but keeps the snapshot when the version cannot be read', async () => {
    await service.onApplicationBootstrap();
    policyState.findOne.mockRejectedValue(new Error('connection lost'));

    await expect(service.getCurrentSnapshot()).rejects.toBeInstanceOf(
      RbacPolicyUnavailableError,
    );
    expect(service.isLoaded()).toBe(true);
  });
});
