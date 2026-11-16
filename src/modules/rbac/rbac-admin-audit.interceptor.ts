import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { catchError, Observable, throwError } from 'rxjs';

import {
  RBAC_AUDIT_TARGET_KEY,
  RbacAuditLogger,
  RbacAuditTarget,
  safeEntityId,
} from './rbac-audit.logger';
import type { AuthenticatedRequest } from './rbac.guard';

type AuditedRequest = AuthenticatedRequest & {
  params?: Record<string, unknown>;
};

/**
 * Logs rejected admin requests (`rbac.admin.rejected`) and passes the error
 * on unchanged, so `AllExceptionsFilter` still builds the response.
 *
 * Interceptors run after the guard and wrap the pipes and the handler, so
 * this sees 400 (validation, `ParseUUIDPipe`), 404, 409 and 503/500 from
 * the service. A 403 from the guard never gets here: the guard logs it as
 * `rbac.access.denied`.
 */
@Injectable()
export class RbacAdminAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: RbacAuditLogger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        this.logRejection(context, error);
        return throwError(() => error);
      }),
    );
  }

  private logRejection(context: ExecutionContext, error: unknown): void {
    const target = this.reflector.getAllAndOverride<
      RbacAuditTarget | undefined
    >(RBAC_AUDIT_TARGET_KEY, [context.getHandler(), context.getClass()]);
    if (!target) {
      return;
    }

    const request = context.switchToHttp().getRequest<AuditedRequest>();
    this.audit.adminRejected({
      actorUserId: request.user?.id,
      operation: context.getHandler().name,
      entityType: target.entityType,
      entityId: target.idParam
        ? safeEntityId(request.params?.[target.idParam])
        : undefined,
      statusCode:
        error instanceof HttpException
          ? error.getStatus()
          : HttpStatus.INTERNAL_SERVER_ERROR,
    });
  }
}
