import { Logger } from '@nestjs/common';

import {
  formatAuditEvent,
  isCriticalOperation,
  RbacAuditLogger,
  safeEntityId,
} from './rbac-audit.logger';

const ID = '6f1c2b8e-4d1a-4c3e-9b7a-1e2d3c4b5a69';

describe('formatAuditEvent', () => {
  it('writes the event, then key=value pairs, skipping undefined', () => {
    expect(formatAuditEvent('rbac.x', { a: 'one', b: undefined, c: 3 })).toBe(
      'rbac.x a=one c=3',
    );
  });
});

describe('safeEntityId', () => {
  it('keeps a UUID and drops anything else', () => {
    expect(safeEntityId(ID)).toBe(ID);
    expect(safeEntityId('x\nrbac.admin.change result=success')).toBeUndefined();
    expect(safeEntityId(42)).toBeUndefined();
  });
});

describe('RbacAuditLogger', () => {
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  const audit = new RbacAuditLogger();

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('logs a committed change with the policy version', () => {
    audit.adminChange({
      actorUserId: 'admin',
      operation: 'create',
      entityType: 'role',
      entityId: ID,
      policyVersion: 7,
    });

    expect(log).toHaveBeenCalledWith(
      `rbac.admin.change actorUserId=admin operation=create entityType=role entityId=${ID} policyVersion=7 result=success`,
    );
  });

  it('logs a rejected admin operation with its status', () => {
    audit.adminRejected({
      actorUserId: 'admin',
      operation: 'delete',
      entityType: 'grant',
      entityId: ID,
      statusCode: 409,
    });

    expect(warn).toHaveBeenCalledWith(
      `rbac.admin.rejected actorUserId=admin operation=delete entityType=grant entityId=${ID} result=409`,
    );
  });

  it('logs an access check that could not run', () => {
    audit.accessUnavailable(
      {
        actorUserId: 'admin',
        permission: 'rbac',
        action: 'manage',
        operation: 'RbacRolesController.create',
      },
      'rbac_version',
    );

    expect(warn).toHaveBeenCalledWith(
      'rbac.access.unavailable actorUserId=admin permission=rbac action=manage operation=RbacRolesController.create category=rbac_version result=503',
    );
  });

  it('logs an access denial with the policy version and category', () => {
    audit.accessDenied(
      {
        actorUserId: 'alice',
        permission: 'users',
        action: 'list',
        operation: 'UsersController.list',
        requestId: 'req-1',
        policyVersion: 3,
      },
      'permission_denied',
    );

    expect(warn).toHaveBeenCalledWith(
      'rbac.access.denied actorUserId=alice permission=users action=list operation=UsersController.list requestId=req-1 policyVersion=3 category=permission_denied result=403',
    );
  });

  it('logs an admission with the target id', () => {
    audit.accessGranted({
      actorUserId: 'admin',
      permission: 'users',
      action: 'read_any',
      operation: 'UsersController.findOne',
      requestId: 'req-2',
      policyVersion: 3,
      targetId: ID,
    });

    expect(log).toHaveBeenCalledWith(
      `rbac.access.granted actorUserId=admin permission=users action=read_any operation=UsersController.findOne requestId=req-2 policyVersion=3 targetId=${ID} result=allowed`,
    );
  });

  it('leaves out a target id that is not a UUID (no log injection)', () => {
    audit.accessGranted({
      actorUserId: 'admin',
      permission: 'users',
      action: 'read_any',
      operation: 'UsersController.findOne',
      policyVersion: 3,
      targetId: 'x\nrbac.access.granted actorUserId=evil',
    });

    expect(log).toHaveBeenCalledWith(
      'rbac.access.granted actorUserId=admin permission=users action=read_any operation=UsersController.findOne policyVersion=3 result=allowed',
    );
  });
});

describe('isCriticalOperation', () => {
  it.each([
    ['rbac', 'manage', true],
    ['users', 'read_any', true],
    ['transformations', 'delete', true],
    ['users', 'read', false],
    ['users', 'update', false],
    ['users', 'manage', false],
  ])('%s@%s → %s', (permission, action, expected) => {
    expect(isCriticalOperation(permission, action)).toBe(expected);
  });
});
