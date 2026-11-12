import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';

import { Grant } from './grant.entity';
import { RbacPolicyChangeService } from './rbac-policy-change.service';
import { RbacRolesService } from './rbac-roles.service';
import { Role } from './role.entity';
import { UserRole } from './user-role.entity';

const pgError = (code: string) =>
  new QueryFailedError(
    'SQL',
    [],
    Object.assign(new Error('pg error'), { code }),
  );

const ROLE_ID = '6f1c2b8e-4d1a-4c3e-9b7a-1e2d3c4b5a69';

const role = (overrides: Partial<Role> = {}): Role =>
  Object.assign(new Role(), {
    id: ROLE_ID,
    name: 'editor',
    description: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });

describe('RbacRolesService', () => {
  let service: RbacRolesService;
  let roles: {
    find: jest.Mock;
    findOneBy: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };
  let grants: { existsBy: jest.Mock };
  let userRoles: { existsBy: jest.Mock };
  let policyChange: { apply: jest.Mock };

  beforeEach(async () => {
    roles = {
      find: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn().mockResolvedValue(role()),
      create: jest.fn((input: Partial<Role>) =>
        Object.assign(new Role(), input),
      ),
      save: jest.fn((input: Role) => Promise.resolve(role(input))),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    grants = { existsBy: jest.fn().mockResolvedValue(false) };
    userRoles = { existsBy: jest.fn().mockResolvedValue(false) };
    // The real helper wraps this in a transaction; here it just runs the change.
    policyChange = {
      apply: jest.fn(async (change: () => Promise<unknown>) => ({
        result: await change(),
        version: 2,
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacRolesService,
        { provide: RbacPolicyChangeService, useValue: policyChange },
        { provide: getRepositoryToken(Role), useValue: roles },
        { provide: getRepositoryToken(Grant), useValue: grants },
        { provide: getRepositoryToken(UserRole), useValue: userRoles },
      ],
    }).compile();

    service = module.get(RbacRolesService);
  });

  describe('list', () => {
    it('returns the roles sorted by name, with role fields only', async () => {
      roles.find.mockResolvedValue([
        Object.assign(role(), { extra: 'not exposed' }),
      ]);

      const result = await service.list();

      expect(roles.find).toHaveBeenCalledWith({ order: { name: 'ASC' } });
      expect(result).toEqual([
        {
          id: ROLE_ID,
          name: 'editor',
          description: null,
          createdAt: role().createdAt,
          updatedAt: role().updatedAt,
        },
      ]);
    });
  });

  describe('create', () => {
    it('saves the role through the policy change helper', async () => {
      const result = await service.create({ name: 'editor' });

      expect(policyChange.apply).toHaveBeenCalledTimes(1);
      expect(roles.create).toHaveBeenCalledWith({
        name: 'editor',
        description: null,
      });
      expect(result.name).toBe('editor');
    });

    it('turns a duplicate name into 409', async () => {
      roles.save.mockRejectedValue(pgError('23505'));

      await expect(service.create({ name: 'editor' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('rethrows other errors unchanged', async () => {
      const error = new Error('connection lost');
      roles.save.mockRejectedValue(error);

      await expect(service.create({ name: 'editor' })).rejects.toBe(error);
    });
  });

  describe('replace', () => {
    it('replaces name and description, clearing a missing description', async () => {
      roles.findOneBy.mockResolvedValue(role({ description: 'old' }));

      const result = await service.replace(ROLE_ID, { name: 'writer' });

      expect(policyChange.apply).toHaveBeenCalledTimes(1);
      expect(roles.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'writer', description: null }),
      );
      expect(result).toMatchObject({ name: 'writer', description: null });
    });

    it('returns 404 for a missing role', async () => {
      roles.findOneBy.mockResolvedValue(null);

      await expect(
        service.replace(ROLE_ID, { name: 'writer' }),
      ).rejects.toThrow(NotFoundException);
      expect(roles.save).not.toHaveBeenCalled();
    });

    it('turns a duplicate name into 409', async () => {
      roles.save.mockRejectedValue(pgError('23505'));

      await expect(service.replace(ROLE_ID, { name: 'admin' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('delete', () => {
    it('deletes an unused role through the policy change helper', async () => {
      await service.delete(ROLE_ID);

      expect(policyChange.apply).toHaveBeenCalledTimes(1);
      expect(roles.delete).toHaveBeenCalledWith(ROLE_ID);
    });

    it('returns 404 for a missing role', async () => {
      roles.findOneBy.mockResolvedValue(null);

      await expect(service.delete(ROLE_ID)).rejects.toThrow(NotFoundException);
      expect(roles.delete).not.toHaveBeenCalled();
    });

    it('returns 409 for a role with grants', async () => {
      grants.existsBy.mockResolvedValue(true);

      await expect(service.delete(ROLE_ID)).rejects.toThrow(ConflictException);
      expect(roles.delete).not.toHaveBeenCalled();
    });

    it('returns 409 for a role assigned to users', async () => {
      userRoles.existsBy.mockResolvedValue(true);

      await expect(service.delete(ROLE_ID)).rejects.toThrow(ConflictException);
      expect(roles.delete).not.toHaveBeenCalled();
    });

    it('returns 409 when a user got the role during the delete', async () => {
      roles.delete.mockRejectedValue(pgError('23503'));

      await expect(service.delete(ROLE_ID)).rejects.toThrow(ConflictException);
    });
  });
});
