import {
  ExecutionContext,
  ForbiddenException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { Public, RequirePermission } from './rbac.decorators';
import { AuthenticatedRequest, RbacGuard } from './rbac.guard';
import { RbacAuditLogger } from './rbac-audit.logger';
import { RbacAuthorizationService } from './rbac-authorization.service';
import { RbacPolicyUnavailableError } from './rbac-policy-snapshot.service';

class TestController {
  @Public()
  open() {}

  @RequirePermission('users', 'read')
  protected() {}

  undeclared() {}

  @Public()
  @RequirePermission('users', 'read')
  ambiguous() {}

  @RequirePermission('Users', 'read')
  invalid() {}

  @RequirePermission('users', 'delete')
  remove() {}
}

@Public()
class PublicController {
  open() {}
}

function contextFor(
  controller: new () => object,
  method: string,
  request: AuthenticatedRequest = {},
): ExecutionContext {
  return {
    getClass: () => controller,
    getHandler: () =>
      (controller.prototype as Record<string, () => void>)[method],
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('RbacGuard', () => {
  let guard: RbacGuard;
  let authorize: jest.Mock;
  let accessDenied: jest.Mock;
  let accessGranted: jest.Mock;
  let accessUnavailable: jest.Mock;

  afterEach(() => jest.restoreAllMocks());

  beforeEach(() => {
    authorize = jest.fn();
    accessDenied = jest.fn();
    accessGranted = jest.fn();
    accessUnavailable = jest.fn();
    guard = new RbacGuard(
      new Reflector(),
      { authorize } as unknown as RbacAuthorizationService,
      {
        accessDenied,
        accessGranted,
        accessUnavailable,
      } as unknown as RbacAuditLogger,
    );
  });

  it('logs a denial with ids only, and nothing when allowed', async () => {
    authorize
      .mockResolvedValueOnce({ allowed: false, policyVersion: 7 })
      .mockResolvedValueOnce({ allowed: true, policyVersion: 7 });
    const request = { user: { id: 'alice' }, id: 'req-1' };

    await expect(
      guard.canActivate(contextFor(TestController, 'protected', request)),
    ).rejects.toThrow(ForbiddenException);
    expect(accessDenied).toHaveBeenCalledWith(
      {
        actorUserId: 'alice',
        permission: 'users',
        action: 'read',
        operation: 'TestController.protected',
        requestId: 'req-1',
        policyVersion: 7,
      },
      'permission_denied',
    );

    await guard.canActivate(contextFor(TestController, 'protected', request));
    expect(accessDenied).toHaveBeenCalledTimes(1);
    // `users@read` is not critical: its admission is not logged.
    expect(accessGranted).not.toHaveBeenCalled();
  });

  it('lets public routes through without a user or a check', async () => {
    await expect(
      guard.canActivate(contextFor(TestController, 'open')),
    ).resolves.toBe(true);
    expect(authorize).not.toHaveBeenCalled();
  });

  it('applies @Public() on the controller class to its routes', async () => {
    await expect(
      guard.canActivate(contextFor(PublicController, 'open')),
    ).resolves.toBe(true);
  });

  it('allows a user who holds the declared permission', async () => {
    authorize.mockResolvedValue({ allowed: true, policyVersion: 1 });

    await expect(
      guard.canActivate(
        contextFor(TestController, 'protected', { user: { id: 'alice' } }),
      ),
    ).resolves.toBe(true);
    expect(authorize).toHaveBeenCalledWith('alice', 'users', 'read');
  });

  it('returns 403 for a user without the permission', async () => {
    authorize.mockResolvedValue({ allowed: false, policyVersion: 1 });

    await expect(
      guard.canActivate(
        contextFor(TestController, 'protected', { user: { id: 'alice' } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns 401 when there is no authenticated user', async () => {
    await expect(
      guard.canActivate(contextFor(TestController, 'protected')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authorize).not.toHaveBeenCalled();
  });

  it('logs and passes on the unavailable policy error instead of a 403', async () => {
    const error = new RbacPolicyUnavailableError('rbac_snapshot');
    authorize.mockRejectedValue(error);

    await expect(
      guard.canActivate(
        contextFor(TestController, 'protected', {
          user: { id: 'alice' },
          id: 'req-2',
        }),
      ),
    ).rejects.toBe(error);
    expect(accessUnavailable).toHaveBeenCalledWith(
      {
        actorUserId: 'alice',
        permission: 'users',
        action: 'read',
        operation: 'TestController.protected',
        requestId: 'req-2',
      },
      'rbac_snapshot',
    );
    expect(accessDenied).not.toHaveBeenCalled();
  });

  it('rethrows other errors from the check without an audit line', async () => {
    authorize.mockRejectedValue(new Error('bug'));

    await expect(
      guard.canActivate(
        contextFor(TestController, 'protected', { user: { id: 'alice' } }),
      ),
    ).rejects.toThrow('bug');
    expect(accessUnavailable).not.toHaveBeenCalled();
  });

  it('logs the admission to a critical operation with the policy version', async () => {
    authorize.mockResolvedValue({ allowed: true, policyVersion: 4 });

    await expect(
      guard.canActivate(
        contextFor(TestController, 'remove', {
          user: { id: 'alice' },
          id: 'req-3',
        }),
      ),
    ).resolves.toBe(true);
    expect(accessGranted).toHaveBeenCalledWith({
      actorUserId: 'alice',
      permission: 'users',
      action: 'delete',
      operation: 'TestController.remove',
      requestId: 'req-3',
      policyVersion: 4,
    });
  });

  it.each(['undeclared', 'ambiguous', 'invalid'])(
    'blocks a route with %s access with 503',
    async (method) => {
      const logError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();

      await expect(
        guard.canActivate(
          contextFor(TestController, method, { user: { id: 'alice' } }),
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(authorize).not.toHaveBeenCalled();
      expect(logError).toHaveBeenCalledWith(
        expect.stringMatching(
          new RegExp(
            `^access\\.refused status=503 category=route_configuration ` +
              `operation=TestController\\.${method} detail=${method}`,
          ),
        ),
      );
    },
  );
});
