import {
  ExecutionContext,
  ForbiddenException,
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
  let accessUnavailable: jest.Mock;

  beforeEach(() => {
    authorize = jest.fn();
    accessDenied = jest.fn();
    accessUnavailable = jest.fn();
    guard = new RbacGuard(
      new Reflector(),
      { authorize } as unknown as RbacAuthorizationService,
      { accessDenied, accessUnavailable } as unknown as RbacAuditLogger,
    );
  });

  it('logs a denial with ids only, and nothing when allowed', async () => {
    authorize.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const request = { user: { id: 'alice' }, id: 'req-1' };

    await expect(
      guard.canActivate(contextFor(TestController, 'protected', request)),
    ).rejects.toThrow(ForbiddenException);
    expect(accessDenied).toHaveBeenCalledWith({
      actorUserId: 'alice',
      permission: 'users',
      action: 'read',
      operation: 'TestController.protected',
      requestId: 'req-1',
    });

    await guard.canActivate(contextFor(TestController, 'protected', request));
    expect(accessDenied).toHaveBeenCalledTimes(1);
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
    authorize.mockResolvedValue(true);

    await expect(
      guard.canActivate(
        contextFor(TestController, 'protected', { user: { id: 'alice' } }),
      ),
    ).resolves.toBe(true);
    expect(authorize).toHaveBeenCalledWith('alice', 'users', 'read');
  });

  it('returns 403 for a user without the permission', async () => {
    authorize.mockResolvedValue(false);

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
    const error = new RbacPolicyUnavailableError();
    authorize.mockRejectedValue(error);

    await expect(
      guard.canActivate(
        contextFor(TestController, 'protected', {
          user: { id: 'alice' },
          id: 'req-2',
        }),
      ),
    ).rejects.toBe(error);
    expect(accessUnavailable).toHaveBeenCalledWith({
      actorUserId: 'alice',
      permission: 'users',
      action: 'read',
      operation: 'TestController.protected',
      requestId: 'req-2',
    });
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

  it.each(['undeclared', 'ambiguous', 'invalid'])(
    'blocks a route with %s access with 503',
    async (method) => {
      await expect(
        guard.canActivate(
          contextFor(TestController, method, { user: { id: 'alice' } }),
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(authorize).not.toHaveBeenCalled();
    },
  );
});
