import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RBAC_NAME_PATTERN } from './dto/rbac-fields';
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
 * What a route declares about access. `undeclared` (no decorator),
 * `ambiguous` (`@Public()` with a pair or a receipt) and `invalid` (a name
 * in the wrong format) are mistakes: the startup scan stops the app, and the
 * guard denies them.
 */
export type RouteAccess =
  | { kind: 'public' }
  | ({ kind: 'permission' } & RequiredPermission)
  | { kind: 'receipt'; header: string }
  | ({ kind: 'receiptOrPermission'; header: string } & RequiredPermission)
  | { kind: 'undeclared' }
  | { kind: 'ambiguous' }
  | { kind: 'invalid'; problem: string };

/**
 * An HTTP header name: a "token" from RFC 9110 §5.6.2. Anything else could
 * never arrive in a request, so the receipt branch would be dead code.
 */
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * Checks the names a route declares. Exact match, no lowercasing: a
 * declaration is code, so `Users` is a typo to fix, not a value to clean up.
 * Without this check a typo would only deny everyone at runtime (the
 * snapshot knows no such permission), which is easy to miss.
 */
function findNameProblem(
  required: RequiredPermission | undefined,
  receiptHeader: string | undefined,
): string | undefined {
  if (required && !RBAC_NAME_PATTERN.test(required.permission)) {
    return `bad permission name "${required.permission}"`;
  }
  if (required && !RBAC_NAME_PATTERN.test(required.action)) {
    return `bad action name "${required.action}"`;
  }
  if (receiptHeader !== undefined && !HEADER_NAME_PATTERN.test(receiptHeader)) {
    return `bad receipt header name "${receiptHeader}"`;
  }
  return undefined;
}

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
  if (isPublic && (required || receiptHeader !== undefined)) {
    return { kind: 'ambiguous' };
  }
  const problem = findNameProblem(required, receiptHeader);
  if (problem) {
    return { kind: 'invalid', problem };
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

/**
 * What the guards do with one request: the route's declaration plus, for a
 * receipt route, whether the request carries the declared header.
 *
 * - `receiptPresented`: the header is there, so the access check and RBAC
 *   are skipped and the handler checks the receipt itself.
 * - `receiptMissing`: a receipt-only route without the header. No identity
 *   is established, so it is a 401 (plan Note: confirm with the mentor).
 * - A receipt + pair route without the header becomes a plain `permission`
 *   route and goes through the usual chain.
 */
export type RequestAccess =
  | { kind: 'public' }
  | ({ kind: 'permission' } & RequiredPermission)
  | { kind: 'receiptPresented'; header: string }
  | { kind: 'receiptMissing'; header: string }
  | { kind: 'undeclared' }
  | { kind: 'ambiguous' }
  | { kind: 'invalid'; problem: string };

/** Request headers as Fastify gives them: names are always lowercase. */
type RequestHeaders = Record<string, string | string[] | undefined>;

/**
 * Applies the receipt rule of 1.3 §1.3.5 to one request. Shared by
 * `AccessCheckGuard` and `RbacGuard`, so both make the same choice.
 * Only "is the header there" is decided here; whether the receipt is valid
 * is the handler's job.
 */
export function resolveRequestAccess(
  access: RouteAccess,
  headers: RequestHeaders | undefined,
): RequestAccess {
  if (access.kind !== 'receipt' && access.kind !== 'receiptOrPermission') {
    return access;
  }

  // The header name is declared as `Deletion-Receipt`, but Fastify stores
  // it as `deletion-receipt`.
  const isPresent = headers?.[access.header.toLowerCase()] !== undefined;
  if (isPresent) {
    return { kind: 'receiptPresented', header: access.header };
  }
  if (access.kind === 'receiptOrPermission') {
    return {
      kind: 'permission',
      permission: access.permission,
      action: access.action,
    };
  }
  return { kind: 'receiptMissing', header: access.header };
}
