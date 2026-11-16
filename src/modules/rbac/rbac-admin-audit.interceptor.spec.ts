import {
  CallHandler,
  ConflictException,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';

import { RbacAdminAuditInterceptor } from './rbac-admin-audit.interceptor';
import { AuditTarget, RbacAuditLogger } from './rbac-audit.logger';

const ROLE_ID = '6f1c2b8e-4d1a-4c3e-9b7a-1e2d3c4b5a69';

@AuditTarget('role', 'roleId')
class RolesController {
  delete() {}
}

class UnmarkedController {
  delete() {}
}

function contextFor(
  controller: new () => object,
  request: object,
): ExecutionContext {
  return {
    getClass: () => controller,
    getHandler: () =>
      (controller.prototype as Record<string, () => void>).delete,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const failingWith = (error: unknown): CallHandler => ({
  handle: () => throwError(() => error),
});

describe('RbacAdminAuditInterceptor', () => {
  let adminRejected: jest.Mock;
  let interceptor: RbacAdminAuditInterceptor;

  beforeEach(() => {
    adminRejected = jest.fn();
    interceptor = new RbacAdminAuditInterceptor(new Reflector(), {
      adminRejected,
    } as unknown as RbacAuditLogger);
  });

  it('logs a rejection and rethrows the same error', async () => {
    const error = new ConflictException('Role is in use');
    const context = contextFor(RolesController, {
      user: { id: 'admin' },
      params: { roleId: ROLE_ID },
    });

    await expect(
      lastValueFrom(interceptor.intercept(context, failingWith(error))),
    ).rejects.toBe(error);
    expect(adminRejected).toHaveBeenCalledWith({
      actorUserId: 'admin',
      operation: 'delete',
      entityType: 'role',
      entityId: ROLE_ID,
      statusCode: 409,
    });
  });

  it('logs a non-HTTP error as 500 and drops an id that is not a UUID', async () => {
    const context = contextFor(RolesController, {
      user: { id: 'admin' },
      params: { roleId: 'not-a-uuid' },
    });

    await expect(
      lastValueFrom(
        interceptor.intercept(context, failingWith(new Error('db'))),
      ),
    ).rejects.toThrow('db');
    expect(adminRejected).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: undefined, statusCode: 500 }),
    );
  });

  it('logs nothing on success or without @AuditTarget', async () => {
    await lastValueFrom(
      interceptor.intercept(contextFor(RolesController, {}), {
        handle: () => of('ok'),
      }),
    );
    await expect(
      lastValueFrom(
        interceptor.intercept(
          contextFor(UnmarkedController, {}),
          failingWith(new ConflictException()),
        ),
      ),
    ).rejects.toThrow(ConflictException);

    expect(adminRejected).not.toHaveBeenCalled();
  });
});
