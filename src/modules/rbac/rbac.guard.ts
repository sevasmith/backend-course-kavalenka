import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { apiError, ErrorCode } from '@/core/http/api-error';
import { getRouteAccess } from './rbac.decorators';
import { RbacAuthorizationService } from './rbac-authorization.service';

/**
 * What the guard needs from the request. Stub until 1.2 Authentication:
 * nothing sets `user` yet, so every protected route answers 401.
 */
export interface AuthenticatedRequest {
  user?: { id: string };
}

/**
 * The single place where access is decided for every route (registered as
 * a global guard). Default deny: only `@Public()` routes and routes whose
 * `permission@action` the user holds get through.
 *
 * Errors: 401 `invalid_session`, 403 `permission_denied` (the defaults for
 * those statuses, see `AllExceptionsFilter`) and 503
 * `authorization_unavailable`. The 403 is the same for every denial: it
 * never names the missing permission or the user's roles.
 * `RbacPolicyUnavailableError` from `authorize` is not caught here on
 * purpose: it is already a 503, and must not become a 403.
 */
@Injectable()
export class RbacGuard implements CanActivate {
  private readonly logger = new Logger(RbacGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationService: RbacAuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const access = getRouteAccess(
      this.reflector,
      context.getHandler(),
      context.getClass(),
    );

    switch (access.kind) {
      case 'public':
        return true;

      case 'undeclared':
      case 'ambiguous': {
        // The startup scan should make this unreachable. If a route slips
        // through anyway, it is blocked, never opened (`task.md`: 503).
        const route = `${context.getClass().name}.${context.getHandler().name}`;
        this.logger.error(`Route ${route} has ${access.kind} access, denied`);
        throw new ServiceUnavailableException(
          apiError(
            ErrorCode.AUTHORIZATION_UNAVAILABLE,
            'Route access is not declared',
          ),
        );
      }

      case 'permission': {
        // `userId` comes only from the auth context, never from the request
        // body, params or headers the client controls.
        const request = context
          .switchToHttp()
          .getRequest<AuthenticatedRequest>();
        const userId = request.user?.id;
        if (!userId) {
          throw new UnauthorizedException();
        }

        const allowed = await this.authorizationService.authorize(
          userId,
          access.permission,
          access.action,
        );
        if (!allowed) {
          throw new ForbiddenException();
        }
        return true;
      }
    }
  }
}
