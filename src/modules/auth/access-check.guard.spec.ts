import {
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { Public, RequirePermission } from '@/modules/rbac/rbac.decorators';
import type { AuthenticatedRequest } from '@/modules/rbac/rbac.guard';
import { UsersService } from '@/modules/users/users.service';
import { UserStatus } from '@/modules/users/user.types';
import { AccessCheckGuard } from './access-check.guard';
import { TokenService } from './token.service';
import { TokenFailure, TokenVerification } from './token.types';

class TestController {
  @Public()
  open() {}

  @RequirePermission('users', 'read')
  protected() {}

  undeclared() {}
}

type TestRequest = AuthenticatedRequest & {
  cookies?: Record<string, string | undefined>;
};

function contextFor(method: string, request: TestRequest): ExecutionContext {
  return {
    getClass: () => TestController,
    getHandler: () =>
      (TestController.prototype as unknown as Record<string, () => void>)[
        method
      ],
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('AccessCheckGuard', () => {
  const userId = '7d9f3c2e-0000-4000-8000-000000000001';

  let guard: AccessCheckGuard;
  let verifyAccess: jest.Mock<TokenVerification, [string | undefined]>;
  let findStatusById: jest.Mock;

  beforeEach(() => {
    verifyAccess = jest.fn<TokenVerification, [string | undefined]>();
    findStatusById = jest.fn();
    guard = new AccessCheckGuard(
      new Reflector(),
      { verifyAccess } as unknown as TokenService,
      { findStatusById } as unknown as UsersService,
    );
  });

  const protectedRequest = (token = 'a.b.c'): TestRequest => ({
    cookies: { access_token: token },
  });

  const expectInvalidSession = async (request: TestRequest) => {
    const error: unknown = await guard
      .canActivate(contextFor('protected', request))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toMatchObject({
      code: 'invalid_session',
    });
    expect(request.user).toBeUndefined();
  };

  it('lets a public route through without reading the cookie', async () => {
    await expect(guard.canActivate(contextFor('open', {}))).resolves.toBe(true);
    expect(verifyAccess).not.toHaveBeenCalled();
  });

  it('leaves an undeclared route to RbacGuard (its 503)', async () => {
    await expect(guard.canActivate(contextFor('undeclared', {}))).resolves.toBe(
      true,
    );
    expect(verifyAccess).not.toHaveBeenCalled();
  });

  it('sets only the user id for an active user', async () => {
    verifyAccess.mockReturnValue({ ok: true, userId });
    findStatusById.mockResolvedValue({ id: userId, status: UserStatus.ACTIVE });
    const request = protectedRequest('the-token');

    await expect(
      guard.canActivate(contextFor('protected', request)),
    ).resolves.toBe(true);

    expect(verifyAccess).toHaveBeenCalledWith('the-token');
    expect(findStatusById).toHaveBeenCalledWith(userId);
    expect(request.user).toEqual({ id: userId });
  });

  it('answers 401 without a cookie', async () => {
    verifyAccess.mockReturnValue({ ok: false, reason: TokenFailure.MISSING });

    await expectInvalidSession({});
    expect(verifyAccess).toHaveBeenCalledWith(undefined);
    expect(findStatusById).not.toHaveBeenCalled();
  });

  it.each(Object.values(TokenFailure))(
    'answers 401 for a token failure: %s',
    async (reason) => {
      verifyAccess.mockReturnValue({ ok: false, reason });

      await expectInvalidSession(protectedRequest());
      expect(findStatusById).not.toHaveBeenCalled();
    },
  );

  it('answers 401 when the user no longer exists', async () => {
    verifyAccess.mockReturnValue({ ok: true, userId });
    findStatusById.mockResolvedValue(null);

    await expectInvalidSession(protectedRequest());
  });

  it.each([
    UserStatus.PENDING,
    UserStatus.BLOCKED,
    UserStatus.DELETING,
    UserStatus.DELETED,
  ])('answers 401 for a %s user', async (status) => {
    verifyAccess.mockReturnValue({ ok: true, userId });
    findStatusById.mockResolvedValue({ id: userId, status });

    await expectInvalidSession(protectedRequest());
  });

  it('answers 503, not 401, when the database fails', async () => {
    verifyAccess.mockReturnValue({ ok: true, userId });
    findStatusById.mockRejectedValue(new Error('connection refused'));
    const request = protectedRequest();

    await expect(
      guard.canActivate(contextFor('protected', request)),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(request.user).toBeUndefined();
  });

  it('ignores a user set before the guard ran', async () => {
    verifyAccess.mockReturnValue({ ok: false, reason: TokenFailure.MISSING });

    await expectInvalidSession({ user: { id: userId } });
  });
});
