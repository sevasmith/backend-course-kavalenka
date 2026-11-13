import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';

import { User } from '@/modules/users/user.entity';
import {
  RbacManageInvariantError,
  RbacPolicyChangeService,
} from './rbac-policy-change.service';
import { RbacUserRolesService } from './rbac-user-roles.service';
import { Role } from './role.entity';
import { UserRole } from './user-role.entity';

const USER_ID = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const ROLE_A = '0b6f1c2a-3d4e-4f5a-8b6c-7d8e9f0a1b2c';
const ROLE_B = '3a7d1f0e-2b4c-4e6a-8d9f-1c2b3a4d5e6f';

describe('RbacUserRolesService', () => {
  let service: RbacUserRolesService;
  let userRoles: { findBy: jest.Mock; delete: jest.Mock; insert: jest.Mock };
  let roles: { countBy: jest.Mock };
  let users: { existsBy: jest.Mock };
  let policyChange: { apply: jest.Mock };

  beforeEach(async () => {
    userRoles = {
      findBy: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      insert: jest.fn().mockResolvedValue(undefined),
    };
    roles = { countBy: jest.fn().mockResolvedValue(2) };
    users = { existsBy: jest.fn().mockResolvedValue(true) };
    // The real helper wraps this in a transaction; here it just runs the change.
    policyChange = {
      apply: jest.fn(async (change: () => Promise<unknown>) => ({
        result: await change(),
        version: 2,
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacUserRolesService,
        { provide: RbacPolicyChangeService, useValue: policyChange },
        { provide: getRepositoryToken(UserRole), useValue: userRoles },
        { provide: getRepositoryToken(Role), useValue: roles },
        { provide: getRepositoryToken(User), useValue: users },
      ],
    }).compile();

    service = module.get(RbacUserRolesService);
  });

  describe('get', () => {
    it("returns the user's role ids, sorted", async () => {
      userRoles.findBy.mockResolvedValue([
        { userId: USER_ID, roleId: ROLE_B },
        { userId: USER_ID, roleId: ROLE_A },
      ]);

      await expect(service.get(USER_ID)).resolves.toEqual({
        userId: USER_ID,
        roleIds: [ROLE_A, ROLE_B],
      });
      expect(userRoles.findBy).toHaveBeenCalledWith({ userId: USER_ID });
    });

    it('throws 404 when the user does not exist', async () => {
      users.existsBy.mockResolvedValue(false);

      await expect(service.get(USER_ID)).rejects.toThrow(NotFoundException);
      expect(userRoles.findBy).not.toHaveBeenCalled();
    });
  });

  describe('replace', () => {
    it('replaces all links in one policy change', async () => {
      const result = await service.replace(USER_ID, {
        roleIds: [ROLE_B, ROLE_A],
      });

      expect(policyChange.apply).toHaveBeenCalledTimes(1);
      expect(roles.countBy).toHaveBeenCalledWith({ id: In([ROLE_B, ROLE_A]) });
      expect(userRoles.delete).toHaveBeenCalledWith({ userId: USER_ID });
      expect(userRoles.insert).toHaveBeenCalledWith([
        { userId: USER_ID, roleId: ROLE_B },
        { userId: USER_ID, roleId: ROLE_A },
      ]);
      expect(result).toEqual({ userId: USER_ID, roleIds: [ROLE_A, ROLE_B] });
    });

    it('removes all roles for an empty list', async () => {
      const result = await service.replace(USER_ID, { roleIds: [] });

      expect(roles.countBy).not.toHaveBeenCalled();
      expect(userRoles.delete).toHaveBeenCalledWith({ userId: USER_ID });
      expect(userRoles.insert).not.toHaveBeenCalled();
      expect(result.roleIds).toEqual([]);
    });

    it('throws 404 when the user does not exist', async () => {
      users.existsBy.mockResolvedValue(false);

      await expect(
        service.replace(USER_ID, { roleIds: [ROLE_A] }),
      ).rejects.toThrow(NotFoundException);
      expect(userRoles.delete).not.toHaveBeenCalled();
    });

    it('throws 404 when a role does not exist', async () => {
      roles.countBy.mockResolvedValue(1);

      await expect(
        service.replace(USER_ID, { roleIds: [ROLE_A, ROLE_B] }),
      ).rejects.toThrow(NotFoundException);
      expect(userRoles.delete).not.toHaveBeenCalled();
    });

    it('lets the rbac@manage invariant error through', async () => {
      const invariant = new RbacManageInvariantError();
      policyChange.apply.mockRejectedValue(invariant);

      await expect(service.replace(USER_ID, { roleIds: [] })).rejects.toBe(
        invariant,
      );
    });
  });
});
