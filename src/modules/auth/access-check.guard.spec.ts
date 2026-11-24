import {
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RequirePermission } from '@/modules/rbac/rbac.decorators';
import { UsersService } from '@/modules/users/users.service';
import { UserStatus } from '@/modules/users/user.types';
import { AccessCheckGuard } from './access-check.guard';
import { TokenService } from './token.service';

const USER_ID = '7f1c1d2e-0000-4000-8000-000000000001';

class TestController {
  @RequirePermission('rbac', 'manage')
  protectedRoute() {}
}

interface TestRequest {
  cookies: Record<string, string>;
  user?: { id: string };
}

function contextFor(request: TestRequest): ExecutionContext {
  return {
    getHandler: () =>
      (TestController.prototype as unknown as Record<string, () => void>)
        .protectedRoute,
    getClass: () => TestController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the guard to throw');
}

describe('AccessCheckGuard', () => {
  let findStatusById: jest.Mock;
  let guard: AccessCheckGuard;
  let request: TestRequest;

  beforeEach(() => {
    findStatusById = jest.fn();
    guard = new AccessCheckGuard(
      new Reflector(),
      {
        verifyAccess: () => ({ ok: true, userId: USER_ID }),
      } as unknown as TokenService,
      { findStatusById } as unknown as UsersService,
    );
    request = { cookies: { access_token: 'token' } };
  });

  it('lets an active user through and sets only the id', async () => {
    findStatusById.mockResolvedValue({
      id: USER_ID,
      status: UserStatus.ACTIVE,
    });

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.user).toEqual({ id: USER_ID });
  });

  it('answers 503 authorization_unavailable when the users DB fails', async () => {
    findStatusById.mockRejectedValue(new Error('connection refused'));

    const error = await captureError(guard.canActivate(contextFor(request)));

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    const body = (error as ServiceUnavailableException).getResponse();
    expect(body).toMatchObject({ code: 'authorization_unavailable' });
    // The body never names the user or the cause.
    expect(JSON.stringify(body)).not.toContain(USER_ID);
    expect(JSON.stringify(body)).not.toContain('connection refused');
    expect(request.user).toBeUndefined();
  });

  it('answers the shared 401 for a non-active user without naming the status', async () => {
    findStatusById.mockResolvedValue({
      id: USER_ID,
      status: UserStatus.BLOCKED,
    });

    const error = await captureError(guard.canActivate(contextFor(request)));

    expect(error).toBeInstanceOf(UnauthorizedException);
    const body = (error as UnauthorizedException).getResponse();
    expect(body).toMatchObject({ code: 'invalid_session' });
    expect(JSON.stringify(body)).not.toContain(UserStatus.BLOCKED);
    expect(JSON.stringify(body)).not.toContain(USER_ID);
  });
});
