import {
  ExecutionContext,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { Public, RequirePermission } from '@/modules/rbac/rbac.decorators';
import type { AuthenticatedRequest } from '@/modules/rbac/rbac.guard';
import { UsersService } from '@/modules/users/users.service';
import { UserStatus } from '@/modules/users/user.types';
import { AccessCheckGuard } from './access-check.guard';
import { INVALID_SESSION_MESSAGE } from './auth.types';
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
  let warn: jest.SpyInstance;
  let logError: jest.SpyInstance;

  afterEach(() => jest.restoreAllMocks());

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
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
    const body = (error as UnauthorizedException).getResponse();
    // Exactly the shared 401: no user id, status or failure reason.
    expect(body).toEqual({
      code: 'invalid_session',
      message: INVALID_SESSION_MESSAGE,
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
      // The token failure is the log category as is.
      expect(warn).toHaveBeenCalledWith(
        `access.refused status=401 category=${reason}`,
      );
    },
  );

  it('answers 401 when the user no longer exists', async () => {
    verifyAccess.mockReturnValue({ ok: true, userId });
    findStatusById.mockResolvedValue(null);

    await expectInvalidSession(protectedRequest());
    expect(warn).toHaveBeenCalledWith(
      `access.refused status=401 category=user_inactive detail=not_found userId=${userId}`,
    );
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
    expect(warn).toHaveBeenCalledWith(
      `access.refused status=401 category=user_inactive detail=${status} userId=${userId}`,
    );
  });

  it('answers 503 authorization_unavailable, not 401, when the database fails', async () => {
    verifyAccess.mockReturnValue({ ok: true, userId });
    findStatusById.mockRejectedValue(new Error('connection refused'));
    const request = protectedRequest();

    const error: unknown = await guard
      .canActivate(contextFor('protected', request))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    const body = (error as ServiceUnavailableException).getResponse();
    expect(body).toMatchObject({ code: 'authorization_unavailable' });
    // The body never names the user or the cause.
    expect(JSON.stringify(body)).not.toContain(userId);
    expect(JSON.stringify(body)).not.toContain('connection refused');
    expect(request.user).toBeUndefined();
    // The log names the dependency, never the error message.
    expect(logError).toHaveBeenCalledWith(
      `access.refused status=503 category=users userId=${userId} error=Error`,
    );
  });

  it('ignores a user set before the guard ran', async () => {
    verifyAccess.mockReturnValue({ ok: false, reason: TokenFailure.MISSING });

    await expectInvalidSession({ user: { id: userId } });
  });
});
