import { Logger } from '@nestjs/common';

import {
  formatAuditEvent,
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

  it('logs an access denial', () => {
    audit.accessDenied({
      actorUserId: 'alice',
      permission: 'users',
      action: 'list',
      operation: 'UsersController.list',
      requestId: 'req-1',
    });

    expect(warn).toHaveBeenCalledWith(
      'rbac.access.denied actorUserId=alice permission=users action=list operation=UsersController.list requestId=req-1 result=403',
    );
  });
});
