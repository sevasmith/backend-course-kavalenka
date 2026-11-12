import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, QueryFailedError } from 'typeorm';

import { Grant } from './grant.entity';
import { GrantAction } from './grant-action.entity';
import { Permission } from './permission.entity';
import { PermissionAction } from './permission-action.entity';
import { RbacPermissionsService } from './rbac-permissions.service';
import { RbacPolicyChangeService } from './rbac-policy-change.service';

const pgError = (code: string) =>
  new QueryFailedError(
    'SQL',
    [],
    Object.assign(new Error('pg error'), { code }),
  );

const PERMISSION_ID = '3a7d1f0e-2b4c-4e6a-8d9f-1c2b3a4d5e6f';

const permission = (overrides: Partial<Permission> = {}): Permission =>
  Object.assign(new Permission(), {
    id: PERMISSION_ID,
    name: 'reports',
    description: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });

const action = (id: string, name: string): PermissionAction =>
  Object.assign(new PermissionAction(), {
    id,
    permissionId: PERMISSION_ID,
    name,
  });

describe('RbacPermissionsService', () => {
  let service: RbacPermissionsService;
  let permissions: {
    find: jest.Mock;
    findOneBy: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let actions: {
    find: jest.Mock;
    findBy: jest.Mock;
    insert: jest.Mock;
    delete: jest.Mock;
  };
  let grants: { existsBy: jest.Mock };
  let grantActions: { existsBy: jest.Mock };
  let policyChange: { apply: jest.Mock };

  beforeEach(async () => {
    permissions = {
      find: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn().mockResolvedValue(permission()),
      create: jest.fn((input: Partial<Permission>) =>
        Object.assign(new Permission(), input),
      ),
      // Like the DB: keeps the given fields and fills in the generated id.
      save: jest.fn((input: Permission) =>
        Promise.resolve(
          permission({ name: input.name, description: input.description }),
        ),
      ),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    actions = {
      find: jest.fn().mockResolvedValue([]),
      findBy: jest
        .fn()
        .mockResolvedValue([
          action('act-read', 'read'),
          action('act-export', 'export'),
        ]),
      insert: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    grants = { existsBy: jest.fn().mockResolvedValue(false) };
    grantActions = { existsBy: jest.fn().mockResolvedValue(false) };
    // The real helper wraps this in a transaction; here it just runs the change.
    policyChange = {
      apply: jest.fn(async (change: () => Promise<unknown>) => ({
        result: await change(),
        version: 2,
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacPermissionsService,
        { provide: RbacPolicyChangeService, useValue: policyChange },
        { provide: getRepositoryToken(Permission), useValue: permissions },
        { provide: getRepositoryToken(PermissionAction), useValue: actions },
        { provide: getRepositoryToken(Grant), useValue: grants },
        { provide: getRepositoryToken(GrantAction), useValue: grantActions },
      ],
    }).compile();

    service = module.get(RbacPermissionsService);
  });

  describe('list', () => {
    it('returns each permission with its sorted actions', async () => {
      permissions.find.mockResolvedValue([
        permission(),
        permission({ id: 'other', name: 'empty' }),
      ]);
      actions.find.mockResolvedValue([
        action('a1', 'read'),
        action('a2', 'export'),
      ]);

      const result = await service.list();

      expect(permissions.find).toHaveBeenCalledWith({ order: { name: 'ASC' } });
      expect(result.map((p) => [p.name, p.actions])).toEqual([
        ['reports', ['export', 'read']],
        ['empty', []],
      ]);
    });
  });

  describe('create', () => {
    it('saves the permission and its actions in one policy change', async () => {
      const result = await service.create({
        name: 'reports',
        actions: ['read', 'export'],
      });

      expect(policyChange.apply).toHaveBeenCalledTimes(1);
      expect(actions.insert).toHaveBeenCalledWith([
        { permissionId: PERMISSION_ID, name: 'read' },
        { permissionId: PERMISSION_ID, name: 'export' },
      ]);
      expect(result).toMatchObject({
        id: PERMISSION_ID,
        name: 'reports',
        description: null,
        actions: ['export', 'read'],
      });
    });

    it('turns a duplicate name into 409', async () => {
      permissions.save.mockRejectedValue(pgError('23505'));

      await expect(
        service.create({ name: 'reports', actions: ['read'] }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('replace', () => {
    it('keeps, removes and adds actions, and replaces the fields', async () => {
      await service.replace(PERMISSION_ID, {
        name: 'reports',
        description: 'Reports',
        actions: ['read', 'print'],
      });

      expect(grantActions.existsBy).toHaveBeenCalledWith({
        permissionActionId: In(['act-export']),
      });
      expect(actions.delete).toHaveBeenCalledWith({ id: In(['act-export']) });
      expect(actions.insert).toHaveBeenCalledWith([
        { permissionId: PERMISSION_ID, name: 'print' },
      ]);
      expect(permissions.update).toHaveBeenCalledWith(PERMISSION_ID, {
        name: 'reports',
        description: 'Reports',
      });
    });

    it('does not touch actions when the set is the same', async () => {
      await service.replace(PERMISSION_ID, {
        name: 'reports',
        actions: ['export', 'read'],
      });

      expect(grantActions.existsBy).not.toHaveBeenCalled();
      expect(actions.delete).not.toHaveBeenCalled();
      expect(actions.insert).not.toHaveBeenCalled();
    });

    it('returns 409 when a removed action is part of an explicit grant', async () => {
      grantActions.existsBy.mockResolvedValue(true);

      await expect(
        service.replace(PERMISSION_ID, { name: 'reports', actions: ['read'] }),
      ).rejects.toThrow(ConflictException);
      expect(actions.delete).not.toHaveBeenCalled();
    });

    it('returns 409 when the DB restricts deleting a used action', async () => {
      actions.delete.mockRejectedValue(pgError('23503'));

      await expect(
        service.replace(PERMISSION_ID, { name: 'reports', actions: ['read'] }),
      ).rejects.toThrow(ConflictException);
    });

    it('returns 404 for a missing permission', async () => {
      permissions.findOneBy.mockResolvedValue(null);

      await expect(
        service.replace(PERMISSION_ID, { name: 'reports', actions: ['read'] }),
      ).rejects.toThrow(NotFoundException);
      expect(actions.findBy).not.toHaveBeenCalled();
    });

    it('turns a duplicate name into 409', async () => {
      permissions.update.mockRejectedValue(pgError('23505'));

      await expect(
        service.replace(PERMISSION_ID, { name: 'users', actions: ['read'] }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('delete', () => {
    it('deletes a permission without grants', async () => {
      await service.delete(PERMISSION_ID);

      expect(policyChange.apply).toHaveBeenCalledTimes(1);
      expect(permissions.delete).toHaveBeenCalledWith(PERMISSION_ID);
    });

    it('returns 404 for a missing permission', async () => {
      permissions.findOneBy.mockResolvedValue(null);

      await expect(service.delete(PERMISSION_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns 409 for a permission with grants', async () => {
      grants.existsBy.mockResolvedValue(true);

      await expect(service.delete(PERMISSION_ID)).rejects.toThrow(
        ConflictException,
      );
      expect(permissions.delete).not.toHaveBeenCalled();
    });
  });
});
