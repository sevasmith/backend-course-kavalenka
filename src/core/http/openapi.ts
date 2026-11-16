import { INestApplication } from '@nestjs/common';
import {
  ApiResponse,
  DocumentBuilder,
  OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';

import { ApiErrorResponseDto } from './api-error-response.dto';

/** Where the Swagger UI is served; the JSON document is at `/docs-json`. */
export const OPENAPI_PATH = 'docs';

/** The cookie that carries the access token (`task.md`, Authentication). */
export const ACCESS_TOKEN_COOKIE = 'access_token';

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
