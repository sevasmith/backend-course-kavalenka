import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  DEFAULT_ROLE_NAME,
  RbacDefaultRoleService,
} from './rbac-default-role.service';
import { RbacPolicyChangeService } from './rbac-policy-change.service';
import { Role } from './role.entity';
import { UserRole } from './user-role.entity';

const USER_ID = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const ROLE_ID = '0b6f1c2a-3d4e-4f5a-8b6c-7d8e9f0a1b2c';

describe('RbacDefaultRoleService', () => {
  let service: RbacDefaultRoleService;
  let roles: { findOneBy: jest.Mock };
  let userRoles: { existsBy: jest.Mock; insert: jest.Mock };
  let policyChange: { apply: jest.Mock };

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    roles = {
      findOneBy: jest
        .fn()
        .mockResolvedValue({ id: ROLE_ID, name: DEFAULT_ROLE_NAME }),
    };
    userRoles = {
      existsBy: jest.fn().mockResolvedValue(false),
      insert: jest.fn().mockResolvedValue(undefined),
    };
    // The real helper joins the caller's transaction; here it just runs it.
    policyChange = {
      apply: jest.fn(async (change: () => Promise<unknown>) => ({
        result: await change(),
        version: 7,
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacDefaultRoleService,
        { provide: RbacPolicyChangeService, useValue: policyChange },
        { provide: getRepositoryToken(Role), useValue: roles },
        { provide: getRepositoryToken(UserRole), useValue: userRoles },
      ],
    }).compile();

    service = module.get(RbacDefaultRoleService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('inserts the user role in a policy change (version + 1)', async () => {
    await expect(service.assignToActivatedUser(USER_ID)).resolves.toBe(
      'assigned',
    );

    expect(roles.findOneBy).toHaveBeenCalledWith({ name: DEFAULT_ROLE_NAME });
    expect(policyChange.apply).toHaveBeenCalledTimes(1);
    expect(userRoles.insert).toHaveBeenCalledWith({
      userId: USER_ID,
      roleId: ROLE_ID,
    });
  });

  it('does nothing when the user already has the role', async () => {
    userRoles.existsBy.mockResolvedValue(true);

    await expect(service.assignToActivatedUser(USER_ID)).resolves.toBe(
      'already_assigned',
    );
    expect(policyChange.apply).not.toHaveBeenCalled();
  });

  it('skips without an error when RBAC is not bootstrapped', async () => {
    roles.findOneBy.mockResolvedValue(null);

    await expect(service.assignToActivatedUser(USER_ID)).resolves.toBe(
      'rbac_not_initialized',
    );
    expect(policyChange.apply).not.toHaveBeenCalled();
  });

  it('lets a failed insert through, so the caller rolls back the activation', async () => {
    const failure = new Error('db down');
    policyChange.apply.mockRejectedValue(failure);

    await expect(service.assignToActivatedUser(USER_ID)).rejects.toBe(failure);
  });
});
