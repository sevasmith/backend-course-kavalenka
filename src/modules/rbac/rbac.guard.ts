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
import { getRouteAccess, resolveRequestAccess } from './rbac.decorators';
import { RbacAccessCheckEvent, RbacAuditLogger } from './rbac-audit.logger';
import { RbacAuthorizationService } from './rbac-authorization.service';
import { RbacPolicyUnavailableError } from './rbac-policy-snapshot.service';

/**
 * What the guard needs from the request. `user` is set only by
 * `AccessCheckGuard`, which runs before this guard: a valid `access_token`
 * cookie of an `active` user. Only the id, never roles from the token.
 */
export interface AuthenticatedRequest {
  user?: { id: string };
  /** Fastify's per-request id, used to find a request in the logs. */
  id?: string;
  /** Read only to see if a declared receipt header is present. */
  headers?: Record<string, string | string[] | undefined>;
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
 * `RbacPolicyUnavailableError` from `authorize` is only logged and rethrown
 * unchanged: it is already a 503, and must not become a 403.
 */
@Injectable()
export class RbacGuard implements CanActivate {
  private readonly logger = new Logger(RbacGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationService: RbacAuthorizationService,
    private readonly audit: RbacAuditLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const access = resolveRequestAccess(
      getRouteAccess(this.reflector, context.getHandler(), context.getClass()),
      request.headers,
    );

    switch (access.kind) {
      case 'public':
        return true;

      // The handler checks the receipt; RBAC has nothing to decide here.
      case 'receiptPresented':
        return true;

      // `AccessCheckGuard` already answered 401. This is a second line of
      // defence if the guard order ever changes.
      case 'receiptMissing':
        throw new UnauthorizedException();

      case 'undeclared':
      case 'ambiguous':
      case 'invalid': {
        // The startup scan should make this unreachable. If a route slips
        // through anyway, it is blocked, never opened (`task.md`: 503).
        // The details go only to the log; the client gets the same neutral
        // 503 as for any other unavailable authorization.
        const route = `${context.getClass().name}.${context.getHandler().name}`;
        const detail = access.kind === 'invalid' ? ` (${access.problem})` : '';
        this.logger.error(
          `Route ${route} has ${access.kind} access${detail}, denied`,
        );
        throw new ServiceUnavailableException(
          apiError(
            ErrorCode.AUTHORIZATION_UNAVAILABLE,
            'Authorization is temporarily unavailable',
          ),
        );
      }

      case 'permission': {
        // `userId` comes only from the auth context, never from the request
        // body, params or headers the client controls.
        const userId = request.user?.id;
        // `AccessCheckGuard` already refused a request without a user. This
        // is a second line of defence if the guard order ever changes.
        if (!userId) {
          throw new UnauthorizedException();
        }

        const auditEvent: RbacAccessCheckEvent = {
          actorUserId: userId,
          permission: access.permission,
          action: access.action,
          operation: `${context.getClass().name}.${context.getHandler().name}`,
          requestId: request.id,
        };

        let allowed: boolean;
        try {
          allowed = await this.authorizationService.authorize(
            userId,
            access.permission,
            access.action,
          );
        } catch (error) {
          // Logged, then rethrown unchanged: it stays a 503, never a 403.
          if (error instanceof RbacPolicyUnavailableError) {
            this.audit.accessUnavailable(auditEvent);
          }
          throw error;
        }

        if (!allowed) {
          // Logged here, not in the response: the 403 itself stays neutral.
          this.audit.accessDenied(auditEvent);
          throw new ForbiddenException();
        }
        return true;
      }
    }
  }
}
