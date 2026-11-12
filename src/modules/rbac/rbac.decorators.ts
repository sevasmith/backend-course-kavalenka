import { ExecutionContext, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const IS_PUBLIC_KEY = 'rbac:isPublic';
export const REQUIRED_PERMISSION_KEY = 'rbac:requiredPermission';

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
 * What a route declares about access. `undeclared` (no decorator) and
 * `ambiguous` (both decorators) are mistakes: the startup scan stops the app,
 * and the guard denies them.
 */
export type RouteAccess =
  | { kind: 'public' }
  | ({ kind: 'permission' } & RequiredPermission)
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

  if (isPublic && required) {
    return { kind: 'ambiguous' };
  }
  if (isPublic) {
    return { kind: 'public' };
  }
  if (required) {
    return { kind: 'permission', ...required };
  }
  return { kind: 'undeclared' };
}
