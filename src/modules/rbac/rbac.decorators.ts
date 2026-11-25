import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedRequest } from './rbac.guard';

export const IS_PUBLIC_KEY = 'rbac:isPublic';
export const REQUIRED_PERMISSION_KEY = 'rbac:requiredPermission';
export const RECEIPT_HEADER_KEY = 'rbac:receiptHeader';

export interface RequiredPermission {
  permission: string;
  action: string;
}

/** The route is open to anyone, no authentication or permission needed. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** The route needs `permission@action`, e.g. `@RequirePermission('users', 'read')`. */
export const RequirePermission = (permission: string, action: string) =>
  SetMetadata<string, RequiredPermission>(REQUIRED_PERMISSION_KEY, {
    permission,
    action,
  });

/**
 * The route can be opened by a secret receipt in this header instead of a
 * session, e.g. `@ReceiptHeader('Deletion-Receipt')`. With the header, the
 * handler checks the receipt; without it, the route's `@RequirePermission()`
 * pair applies, if it has one.
 */
export const ReceiptHeader = (header: string) =>
  SetMetadata<string, string>(RECEIPT_HEADER_KEY, header);

/**
 * The id of the user making the request, from the auth context only (never
 * from the body, params or headers). On a protected route the guard has
 * already checked it is there; the throw is a second line of defence.
 */
export const ActorUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.id;
    if (!userId) {
      throw new UnauthorizedException();
    }
    return userId;
  },
);

/**
 * What a route declares about access. `undeclared` (no decorator) and
 * `ambiguous` (both decorators) are mistakes: the startup scan stops the app,
 * and the guard denies them.
 */
export type RouteAccess =
  | { kind: 'public' }
  | ({ kind: 'permission' } & RequiredPermission)
  | { kind: 'receipt'; header: string }
  | ({ kind: 'receiptOrPermission'; header: string } & RequiredPermission)
  | { kind: 'undeclared' }
  | { kind: 'ambiguous' };

/**
 * Reads the access decorators of a route: the method first, then its
 * controller class, so a decorator on the class applies to all its routes.
 * Shared by the guard and the startup scan, so both judge a route the same way.
 */
export function getRouteAccess(
  reflector: Reflector,
  handler: ReturnType<ExecutionContext['getHandler']>,
  controller: ReturnType<ExecutionContext['getClass']>,
): RouteAccess {
  const targets = [handler, controller];
  const isPublic = reflector.getAllAndOverride<boolean | undefined>(
    IS_PUBLIC_KEY,
    targets,
  );
  const required = reflector.getAllAndOverride<RequiredPermission | undefined>(
    REQUIRED_PERMISSION_KEY,
    targets,
  );

  const receiptHeader = reflector.getAllAndOverride<string | undefined>(
    RECEIPT_HEADER_KEY,
    targets,
  );

  // `@Public()` with a pair or a receipt is a contradiction (1.3 §1.3.5).
  if (isPublic && (required || receiptHeader)) {
    return { kind: 'ambiguous' };
  }
  if (isPublic) {
    return { kind: 'public' };
  }
  if (receiptHeader && required) {
    return { kind: 'receiptOrPermission', header: receiptHeader, ...required };
  }
  if (receiptHeader) {
    return { kind: 'receipt', header: receiptHeader };
  }
  if (required) {
    return { kind: 'permission', ...required };
  }
  return { kind: 'undeclared' };
}
