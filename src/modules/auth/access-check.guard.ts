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
import {
  formatRefusal,
  UnauthorizedCategory,
  UnavailableCategory,
} from '@/core/logging/refusal-log';
import {
  getRouteAccess,
  resolveRequestAccess,
} from '@/modules/rbac/rbac.decorators';
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
 * A database error is 503 `authorization_unavailable` (1.3 §1.3.1): the
 * session may be fine, so it is not a 401, and the access decision cannot
 * be made, so it is the same code as an unavailable RBAC snapshot.
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
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & AuthenticatedRequest>();
    const access = resolveRequestAccess(
      getRouteAccess(this.reflector, context.getHandler(), context.getClass()),
      request.headers,
    );

    // A receipt-only route called without its header: there is no receipt
    // and no session to fall back on.
    if (access.kind === 'receiptMissing') {
      this.reject(UnauthorizedCategory.MISSING, { detail: 'receipt' });
    }
    // Only routes with a permission need a user. `@Public()` routes stay
    // open, a presented receipt is checked by the handler, and undeclared,
    // ambiguous or invalid routes are left to `RbacGuard`, which answers 503
    // for them (a 401 here would hide the misconfiguration).
    if (access.kind !== 'permission') {
      return true;
    }

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
        formatRefusal(
          { status: 503, category: UnavailableCategory.USERS },
          { userId, error: (error as Error).name },
        ),
      );
      throw new ServiceUnavailableException(
        apiError(
          ErrorCode.AUTHORIZATION_UNAVAILABLE,
          'Authorization is temporarily unavailable',
        ),
      );
    }

    // One category for both: 1.3 counts a deleted user as not `active`.
    // The exact status is kept as `detail` for whoever reads the log.
    if (!user) {
      this.reject(UnauthorizedCategory.USER_INACTIVE, {
        detail: 'not_found',
        userId,
      });
    }
    if (user.status !== UserStatus.ACTIVE) {
      this.reject(UnauthorizedCategory.USER_INACTIVE, {
        detail: user.status,
        userId,
      });
    }

    // Only the id: no roles or other claims. RBAC reads the roles itself.
    request.user = { id: user.id };
    return true;
  }

  /** Logs the category (never the token) and throws the shared 401. */
  private reject(
    category: UnauthorizedCategory,
    fields: { detail?: string; userId?: string } = {},
  ): never {
    this.logger.warn(formatRefusal({ status: 401, category }, fields));
    throw new UnauthorizedException(
      apiError(ErrorCode.INVALID_SESSION, INVALID_SESSION_MESSAGE),
    );
  }
}
