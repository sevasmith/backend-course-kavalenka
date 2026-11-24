import { applyDecorators } from '@nestjs/common';
import { ApiCookieAuth, ApiParam, ApiTags } from '@nestjs/swagger';

import {
  ACCESS_TOKEN_COOKIE,
  ApiCsrfHeader,
  ApiErrorResponse,
  ApiRateLimitResponse,
  CSRF_REJECTED_DESCRIPTION,
} from '@/core/http/openapi';

const PERMISSION_DENIED_DESCRIPTION =
  '`permission_denied`: the user lacks `rbac@manage`. Returned before any ' +
  'lookup, so it never reveals whether a resource exists.';

/**
 * OpenAPI for an RBAC admin controller: its tag, the cookie auth, and the
 * errors every route shares. They come from the guards and run before the
 * handler, so they apply to every admin route.
 */
export const ApiRbacAdmin = (tag: string) =>
  applyDecorators(
    ApiTags(tag),
    ApiCookieAuth(ACCESS_TOKEN_COOKIE),
    ApiErrorResponse(401),
    ApiErrorResponse(403, PERMISSION_DENIED_DESCRIPTION),
    ApiRateLimitResponse(),
    ApiErrorResponse(503),
  );

/**
 * For a route that changes data (POST, PUT, DELETE): `CsrfGuard` checks it,
 * so it gets the CSRF header, and its 403 names both codes (OpenAPI keeps
 * one entry per status, so this replaces the controller's 403).
 */
export const ApiRbacWrite = () =>
  applyDecorators(
    ApiCsrfHeader(),
    ApiErrorResponse(
      403,
      `${PERMISSION_DENIED_DESCRIPTION} Or ${CSRF_REJECTED_DESCRIPTION}`,
    ),
  );

/** A UUID path parameter; anything else is a 400 from `ParseUUIDPipe`. */
export const ApiUuidParam = (name: string) =>
  ApiParam({ name, format: 'uuid' });
