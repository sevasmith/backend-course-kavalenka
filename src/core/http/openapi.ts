import { applyDecorators, INestApplication } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiHeader,
  ApiResponse,
  DocumentBuilder,
  OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';

import {
  ApiErrorResponseDto,
  RateLimitErrorDto,
} from './api-error-response.dto';
import { CSRF_HEADER } from './csrf.guard';

/** Where the Swagger UI is served; the JSON document is at `/docs-json`. */
export const OPENAPI_PATH = 'docs';

/** The cookie that carries the access token (`task.md`, Authentication). */
export const ACCESS_TOKEN_COOKIE = 'access_token';

/** The cookie that carries the refresh token (`task.md`, Authentication). */
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

/**
 * Builds the OpenAPI document from the controllers and DTO decorators and
 * serves it with Swagger UI.
 *
 * These routes are registered on Fastify directly, not as Nest controllers,
 * so the RBAC guard and the startup route scan don't apply to them: the
 * docs are public. They contain the API's shape only, no data.
 */
export function setupOpenApi(app: INestApplication): void {
  SwaggerModule.setup(OPENAPI_PATH, app, buildOpenApiDocument(app));
}

/** The document itself; separate so tests can check it without a server. */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Backend course API')
    .setDescription(
      'Monolithic REST API: authentication, RBAC, users and file ' +
        'transformation. Errors always have the shape ' +
        '`{ statusCode, code, message }`.',
    )
    .setVersion('1.0')
    // The third argument names the scheme; `@ApiCookieAuth()` on the
    // controllers must reference the same name.
    .addCookieAuth(
      ACCESS_TOKEN_COOKIE,
      { type: 'apiKey', in: 'cookie' },
      ACCESS_TOKEN_COOKIE,
    )
    // Only `POST /auth/refresh` uses it: the browser sends this cookie to
    // that path alone.
    .addCookieAuth(
      REFRESH_TOKEN_COOKIE,
      { type: 'apiKey', in: 'cookie' },
      REFRESH_TOKEN_COOKIE,
    )
    .build();

  return SwaggerModule.createDocument(app, config);
}

/** The `code` each documented status returns by default. */
const DEFAULT_ERROR_DESCRIPTIONS: Record<number, string> = {
  400: '`bad_request`: the body or a path parameter is invalid.',
  401: '`invalid_session`: no valid access token.',
  403: '`permission_denied`: the user lacks the required permission.',
  404: '`not_found`: the resource does not exist.',
  409: '`conflict`: the change conflicts with the current state.',
  503: '`authorization_unavailable`: the RBAC policy could not be loaded.',
};

/**
 * Documents one error response with the shared error body. `description`
 * replaces the default text to say when this route returns the status.
 */
export const ApiErrorResponse = (status: number, description?: string) =>
  ApiResponse({
    status,
    type: ApiErrorResponseDto,
    description: description ?? DEFAULT_ERROR_DESCRIPTIONS[status],
  });

/**
 * 429 with `retryAfterSeconds` when the wait is known. The global limit
 * (`THROTTLE_GLOBAL_*`, per IP) applies to every route, so every route can
 * return it; `description` adds the route's own limits.
 */
export const ApiRateLimitResponse = (description?: string) =>
  ApiResponse({
    status: 429,
    type: RateLimitErrorDto,
    description:
      '`rate_limit_exceeded`: ' +
      (description ?? 'too many requests from this IP.'),
  });

/** Text of the 403 a state-changing route can return from `CsrfGuard`. */
export const CSRF_REJECTED_DESCRIPTION =
  '`csrf_rejected`: a request from another origin that is not trusted or ' +
  `has no \`${CSRF_HEADER}: 1\`.`;

/**
 * The header `CsrfGuard` checks on POST, PUT, PATCH and DELETE. Only the
 * header: a route documents its 403 itself, because OpenAPI keeps one entry
 * per status and some routes have another 403 too (`permission_denied`).
 */
export const ApiCsrfHeader = () =>
  applyDecorators(
    ApiHeader({
      name: CSRF_HEADER,
      required: false,
      schema: { type: 'string', enum: ['1'] },
      description:
        'Required, with the value `1`, on a request from another origin ' +
        '(a trusted frontend). Not needed from the same origin.',
    }),
  );

/**
 * 401 of every protected route. One code for every cause (no cookie, bad or
 * expired token, user missing or not `active`), so the answer never says
 * which check failed.
 */
export const INVALID_SESSION_DESCRIPTION =
  '`invalid_session`: no valid session (the `access_token` cookie is ' +
  'missing, invalid or expired, or the user is not `active`). The client ' +
  'may call `POST /auth/refresh` once and retry.';

/** Default 403 from `RbacGuard`; a route can replace it to name its pair. */
export const PERMISSION_DENIED_DESCRIPTION =
  '`permission_denied`: the user lacks the required `permission@action`. ' +
  'Returned before any lookup, so it never reveals whether a resource exists.';

/** 403 from the ownership check, only on routes that run it. */
export const OWNERSHIP_DENIED_DESCRIPTION =
  '`ownership_denied`: the resource belongs to another user and the user ' +
  'lacks the matching `*_any` action.';

/** 503 from the access check or `RbacGuard`. */
export const AUTHORIZATION_UNAVAILABLE_DESCRIPTION =
  '`authorization_unavailable`: the user or the RBAC policy could not be ' +
  'read. Retry later.';

export interface ApiProtectedOptions {
  /** Replaces the default `permission_denied` text, e.g. to name the pair. */
  permissionDenied?: string;
  /** The handler checks ownership, so 403 can also be `ownership_denied`. */
  ownership?: boolean;
}

/**
 * The 403 text. OpenAPI keeps one response per status, so every code a
 * route can return as 403 goes into one description.
 */
const forbiddenDescription = (
  { permissionDenied, ownership }: ApiProtectedOptions,
  write: boolean,
) =>
  [
    permissionDenied ?? PERMISSION_DENIED_DESCRIPTION,
    ownership ? OWNERSHIP_DENIED_DESCRIPTION : undefined,
    write ? CSRF_REJECTED_DESCRIPTION : undefined,
  ]
    .filter(Boolean)
    .join(' Or ');

/**
 * A route behind the authorization chain (access check → CSRF → RBAC →
 * ownership): the `access_token` cookie and the errors the chain returns
 * before the handler. Works on a controller or a route. Public routes must
 * not use it: they never read the access cookie, so they return none of
 * these.
 */
export const ApiProtected = (options: ApiProtectedOptions = {}) =>
  applyDecorators(
    ApiCookieAuth(ACCESS_TOKEN_COOKIE),
    ApiErrorResponse(401, INVALID_SESSION_DESCRIPTION),
    ApiErrorResponse(403, forbiddenDescription(options, false)),
    ApiRateLimitResponse(),
    ApiErrorResponse(503, AUTHORIZATION_UNAVAILABLE_DESCRIPTION),
  );

/**
 * Add to a protected route that changes data (POST, PUT, PATCH, DELETE):
 * `CsrfGuard` checks it, so it gets the CSRF header and `csrf_rejected` in
 * its 403. The route-level 403 replaces the controller's one.
 */
export const ApiProtectedWrite = (options: ApiProtectedOptions = {}) =>
  applyDecorators(
    ApiCsrfHeader(),
    ApiErrorResponse(403, forbiddenDescription(options, true)),
  );
