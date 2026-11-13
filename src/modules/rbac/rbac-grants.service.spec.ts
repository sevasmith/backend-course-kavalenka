import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, QueryFailedError } from 'typeorm';

import { Grant } from './grant.entity';
import { GrantAction } from './grant-action.entity';
import { Permission } from './permission.entity';
import { PermissionAction } from './permission-action.entity';
import { RbacGrantsService } from './rbac-grants.service';
import { RbacPolicyChangeService } from './rbac-policy-change.service';
import { Role } from './role.entity';

const pgError = (code: string) =>
  new QueryFailedError(
    'SQL',
    [],
    Object.assign(new Error('pg error'), { code }),
  );

const GRANT_ID = '9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const ROLE_ID = '0b6f1c2a-3d4e-4f5a-8b6c-7d8e9f0a1b2c';
const PERMISSION_ID = '3a7d1f0e-2b4c-4e6a-8d9f-1c2b3a4d5e6f';

const grant = (overrides: Partial<Grant> = {}): Grant =>
  Object.assign(new Grant(), {
    id: GRANT_ID,
    roleId: ROLE_ID,
    permissionId: PERMISSION_ID,
    allActions: false,
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

describe('RbacGrantsService', () => {
  let service: RbacGrantsService;
  let grants: {
    find: jest.Mock;
    findOneBy: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let grantActions: { find: jest.Mock; insert: jest.Mock; delete: jest.Mock };
  let roles: { existsBy: jest.Mock };
  let permissions: { existsBy: jest.Mock };
  let actions: { find: jest.Mock; findBy: jest.Mock };
  let policyChange: { apply: jest.Mock };

  beforeEach(async () => {
    grants = {
      find: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn().mockResolvedValue(grant()),
      create: jest.fn((input: Partial<Grant>) =>
        Object.assign(new Grant(), input),
      ),
      // Like the DB: keeps the given fields and fills in the generated id.
      save: jest.fn((input: Grant) =>
        Promise.resolve(grant({ ...input, id: GRANT_ID })),
      ),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    grantActions = {
      find: jest.fn().mockResolvedValue([]),
      insert: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    roles = { existsBy: jest.fn().mockResolvedValue(true) };
    permissions = { existsBy: jest.fn().mockResolvedValue(true) };
    actions = {
      find: jest.fn().mockResolvedValue([]),
      findBy: jest
        .fn()
        .mockResolvedValue([
          action('act-read', 'read'),
          action('act-list', 'list'),
        ]),
    };
    // The real helper wraps this in a transaction; here it just runs the change.
    policyChange = {
      apply: jest.fn(async (change: () => Promise<unknown>) => ({
        result: await change(),
        version: 2,
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacGrantsService,
        { provide: RbacPolicyChangeService, useValue: policyChange },
        { provide: getRepositoryToken(Grant), useValue: grants },
        { provide: getRepositoryToken(GrantAction), useValue: grantActions },
        { provide: getRepositoryToken(Role), useValue: roles },
        { provide: getRepositoryToken(Permission), useValue: permissions },
        { provide: getRepositoryToken(PermissionAction), useValue: actions },
      ],
    }).compile();

    service = module.get(RbacGrantsService);
  });

  const body = (actionNames?: string[]) => ({
    roleId: ROLE_ID,
    permissionId: PERMISSION_ID,
    actions: actionNames,
  });

  describe('list', () => {
    it('returns explicit grants with action names and all-actions grants with []', async () => {
      grants.find.mockResolvedValue([
        grant(),
        grant({ id: 'all', allActions: true }),
      ]);
      grantActions.find.mockResolvedValue([
        { grantId: GRANT_ID, permissionActionId: 'act-read' },
        { grantId: GRANT_ID, permissionActionId: 'act-list' },
      ]);
      actions.find.mockResolvedValue([
        action('act-read', 'read'),
        action('act-list', 'list'),
      ]);

      const result = await service.list();

      expect(result.map((g) => [g.id, g.allActions, g.actions])).toEqual([
        [GRANT_ID, false, ['list', 'read']],
        ['all', true, []],
      ]);
    });
  });

  describe('create', () => {
    it('stores an explicit grant with one row per action, in one policy change', async () => {
      const result = await service.create(body(['read', 'list']));

      expect(policyChange.apply).toHaveBeenCalledTimes(1);
      expect(actions.findBy).toHaveBeenCalledWith({
        permissionId: PERMISSION_ID,
        name: In(['read', 'list']),
      });
      expect(grants.create).toHaveBeenCalledWith(
        expect.objectContaining({ allActions: false }),
      );
      expect(grantActions.insert).toHaveBeenCalledWith([
        { grantId: GRANT_ID, permissionActionId: 'act-read' },
        { grantId: GRANT_ID, permissionActionId: 'act-list' },
      ]);
      expect(result).toMatchObject({
        allActions: false,
        actions: ['list', 'read'],
      });
    });

    it.each([[undefined], [[]]])(
      'treats actions %p as all actions, with no action rows',
      async (actionNames) => {
        const result = await service.create(body(actionNames));

        expect(grants.create).toHaveBeenCalledWith(
          expect.objectContaining({ allActions: true }),
        );
        expect(actions.findBy).not.toHaveBeenCalled();
        expect(grantActions.insert).not.toHaveBeenCalled();
        expect(result).toMatchObject({ allActions: true, actions: [] });
      },
    );

    it('throws 404 when the role does not exist', async () => {
      roles.existsBy.mockResolvedValue(false);

      await expect(service.create(body())).rejects.toThrow(NotFoundException);
      expect(grants.save).not.toHaveBeenCalled();
    });

    it('throws 404 when the permission does not exist', async () => {
      permissions.existsBy.mockResolvedValue(false);

      await expect(service.create(body())).rejects.toThrow(NotFoundException);
      expect(grants.save).not.toHaveBeenCalled();
    });

    it('throws 400 when an action does not belong to the permission', async () => {
      actions.findBy.mockResolvedValue([action('act-read', 'read')]);

      await expect(service.create(body(['read', 'export']))).rejects.toThrow(
        BadRequestException,
      );
      expect(grants.save).not.toHaveBeenCalled();
    });

    it('maps a duplicate role + permission pair to 409', async () => {
      grants.save.mockRejectedValue(pgError('23505'));

      await expect(service.create(body())).rejects.toThrow(ConflictException);
    });

    it('lets the rbac@manage invariant error through', async () => {
      const invariant = new ConflictException('no admin left');
      policyChange.apply.mockRejectedValue(invariant);

      await expect(service.create(body())).rejects.toBe(invariant);
    });
  });

  describe('replace', () => {
    it('replaces the action rows and the fields', async () => {
      grants.findOneBy.mockResolvedValue(grant({ allActions: false }));

      const result = await service.replace(GRANT_ID, body(['read', 'list']));

      expect(grantActions.delete).toHaveBeenCalledWith({ grantId: GRANT_ID });
      expect(grants.update).toHaveBeenCalledWith(GRANT_ID, {
        roleId: ROLE_ID,
        permissionId: PERMISSION_ID,
        allActions: false,
      });
      expect(grantActions.insert).toHaveBeenCalledWith([
        { grantId: GRANT_ID, permissionActionId: 'act-read' },
        { grantId: GRANT_ID, permissionActionId: 'act-list' },
      ]);
      expect(result.actions).toEqual(['list', 'read']);
    });

    it('switches to all actions when actions are missing', async () => {
      grants.findOneBy.mockResolvedValue(grant({ allActions: true }));

      const result = await service.replace(GRANT_ID, body());

      expect(grantActions.delete).toHaveBeenCalledWith({ grantId: GRANT_ID });
      expect(grants.update).toHaveBeenCalledWith(
        GRANT_ID,
        expect.objectContaining({ allActions: true }),
      );
      expect(grantActions.insert).not.toHaveBeenCalled();
      expect(result).toMatchObject({ allActions: true, actions: [] });
    });

    it('throws 404 when the grant does not exist', async () => {
      grants.findOneBy.mockResolvedValue(null);

      await expect(service.replace(GRANT_ID, body())).rejects.toThrow(
        NotFoundException,
      );
      expect(grants.update).not.toHaveBeenCalled();
    });

    it('maps a pair already used by another grant to 409', async () => {
      grants.update.mockRejectedValue(pgError('23505'));

      await expect(service.replace(GRANT_ID, body())).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('delete', () => {
    it('deletes an existing grant in a policy change', async () => {
      await service.delete(GRANT_ID);

      expect(policyChange.apply).toHaveBeenCalledTimes(1);
      expect(grants.delete).toHaveBeenCalledWith(GRANT_ID);
    });

    it('throws 404 when the grant does not exist', async () => {
      grants.findOneBy.mockResolvedValue(null);

      await expect(service.delete(GRANT_ID)).rejects.toThrow(NotFoundException);
      expect(grants.delete).not.toHaveBeenCalled();
    });
  });
});
