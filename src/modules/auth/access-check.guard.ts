import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { apiError, ErrorCode } from '@/core/http/api-error';
import { getRouteAccess } from '@/modules/rbac/rbac.decorators';
import type { AuthenticatedRequest } from '@/modules/rbac/rbac.guard';
import { UsersService } from '@/modules/users/users.service';
import { UserStatus } from '@/modules/users/user.types';
import { ACCESS_TOKEN_COOKIE } from './auth-cookies';
import { INVALID_SESSION_MESSAGE } from './auth.types';
import { TokenService } from './token.service';

/**
 * The single authentication check of every protected route (1.2 §1.3.6).
 * Registered as a global guard right before `RbacGuard` (see `AppModule`),
 * so RBAC always gets a `userId` it can trust.
 *
 * 1. Verify the `access_token` cookie (HS256, claims, `token_use=access`).
 * 2. Load the user by `sub`, selecting only `id` and `status`.
 * 3. Accept only an `active` user, then set `request.user = { id }`.
 *
 * Every refusal (no cookie, bad or expired token, unknown or non-active
 * user) is the same 401 `invalid_session`; the reason goes only to the log.
 * A database error is 503: the session may be fine, so it is not a 401.
 *
 * The user is read on every request, so a blocked or deleted user loses
 * access at once, not when the 15-minute token expires.
 */
@Injectable()
export class AccessCheckGuard implements CanActivate {
  private readonly logger = new Logger(AccessCheckGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const access = getRouteAccess(
      this.reflector,
      context.getHandler(),
      context.getClass(),
    );
    // Only routes with a permission need a user. `@Public()` routes stay
    // open, and undeclared or ambiguous ones are left to `RbacGuard`, which
    // answers 503 for them (a 401 here would hide the misconfiguration).
    if (access.kind !== 'permission') {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & AuthenticatedRequest>();
    // Never trust a `user` set by anything before this guard.
    request.user = undefined;

    const verification = this.tokenService.verifyAccess(
      request.cookies?.[ACCESS_TOKEN_COOKIE],
    );
    if (!verification.ok) {
      this.reject(verification.reason);
    }

    const { userId } = verification;
    let user: Awaited<ReturnType<UsersService['findStatusById']>>;
    try {
      user = await this.usersService.findStatusById(userId);
    } catch (error) {
      this.logger.error(
        `Access check failed, reason=database, userId=${userId}: ${(error as Error).name}`,
      );
      throw new ServiceUnavailableException(
        apiError(
          ErrorCode.SERVICE_UNAVAILABLE,
          'Service is temporarily unavailable',
        ),
      );
    }

    if (!user) {
      this.reject('user_missing', userId);
    }
    if (user.status !== UserStatus.ACTIVE) {
      this.reject(`user_${user.status}`, userId);
    }

    // Only the id: no roles or other claims. RBAC reads the roles itself.
    request.user = { id: user.id };
    return true;
  }

  /** Logs the reason (never the token) and throws the shared 401. */
  private reject(reason: string, userId?: string): never {
    this.logger.warn(
      `Access refused, reason=${reason}, userId=${userId ?? 'unknown'}`,
    );
    throw new UnauthorizedException(
      apiError(ErrorCode.INVALID_SESSION, INVALID_SESSION_MESSAGE),
    );
  }
}
