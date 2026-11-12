import {
  ExecutionContext,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { Public, RequirePermission } from './rbac.decorators';
import { AuthenticatedRequest, RbacGuard } from './rbac.guard';
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

  beforeEach(() => {
    authorize = jest.fn();
    guard = new RbacGuard(new Reflector(), {
      authorize,
    } as unknown as RbacAuthorizationService);
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

  it('passes on the unavailable policy error instead of a 403', async () => {
    authorize.mockRejectedValue(new RbacPolicyUnavailableError());

    await expect(
      guard.canActivate(
        contextFor(TestController, 'protected', { user: { id: 'alice' } }),
      ),
    ).rejects.toBeInstanceOf(RbacPolicyUnavailableError);
  });

  it.each(['undeclared', 'ambiguous'])(
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
