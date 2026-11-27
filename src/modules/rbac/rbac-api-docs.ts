import { applyDecorators } from '@nestjs/common';
import { ApiParam, ApiTags } from '@nestjs/swagger';

import { ApiProtected, ApiProtectedWrite } from '@/core/http/openapi';

const PERMISSION_DENIED_DESCRIPTION =
  '`permission_denied`: the user lacks `rbac@manage`. Returned before any ' +
  'lookup, so it never reveals whether a resource exists.';

/**
 * OpenAPI for an RBAC admin controller: its tag and the shared protected
 * route docs (cookie auth, 401/403/429/503). The guards return these before
 * the handler, so they apply to every admin route. No ownership check:
 * `rbac@manage` covers every resource.
 */
export const ApiRbacAdmin = (tag: string) =>
  applyDecorators(
    ApiTags(tag),
    ApiProtected({ permissionDenied: PERMISSION_DENIED_DESCRIPTION }),
  );

/** For a route that changes data (POST, PUT, DELETE): CSRF header and 403. */
export const ApiRbacWrite = () =>
  ApiProtectedWrite({ permissionDenied: PERMISSION_DENIED_DESCRIPTION });

/** A UUID path parameter; anything else is a 400 from `ParseUUIDPipe`. */
export const ApiUuidParam = (name: string) =>
  ApiParam({ name, format: 'uuid' });
