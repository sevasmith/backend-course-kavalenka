import { applyDecorators } from '@nestjs/common';
import { ApiCookieAuth, ApiParam, ApiTags } from '@nestjs/swagger';

import { ACCESS_TOKEN_COOKIE, ApiErrorResponse } from '@/core/http/openapi';

/**
 * OpenAPI for an RBAC admin controller: its tag, the cookie auth, and the
 * errors every route shares. They come from the guard and run before the
 * handler, so the same three apply to every admin route.
 */
export const ApiRbacAdmin = (tag: string) =>
  applyDecorators(
    ApiTags(tag),
    ApiCookieAuth(ACCESS_TOKEN_COOKIE),
    ApiErrorResponse(401),
    ApiErrorResponse(
      403,
      '`permission_denied`: the user lacks `rbac@manage`. Returned before ' +
        'any lookup, so it never reveals whether a resource exists.',
    ),
    ApiErrorResponse(503),
  );

/** A UUID path parameter; anything else is a 400 from `ParseUUIDPipe`. */
export const ApiUuidParam = (name: string) =>
  ApiParam({ name, format: 'uuid' });
