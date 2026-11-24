import { applyDecorators } from '@nestjs/common';
import { ApiNoContentResponse, ApiResponse } from '@nestjs/swagger';

import {
  ApiCsrfHeader,
  ApiErrorResponse,
  CSRF_REJECTED_DESCRIPTION,
} from '@/core/http/openapi';
import { LoginUnavailableErrorDto } from './dto/login-responses.dto';

/**
 * OpenAPI helpers for the auth routes. The cookies are `HttpOnly`, so a
 * client never reads them: it only has to keep them (`credentials:
 * "include"` in a browser, a cookie jar in an HTTP client).
 */

/** What every auth POST shares: the CSRF header and its 403. */
export const ApiAuthPost = () =>
  applyDecorators(
    ApiCsrfHeader(),
    ApiErrorResponse(403, CSRF_REJECTED_DESCRIPTION),
  );

/** 204 that sets both auth cookies. */
export const ApiAuthCookiesSet = (description: string) =>
  ApiNoContentResponse({
    description:
      `${description} No body. Sets two \`HttpOnly; Secure\` cookies: ` +
      '`access_token` (`Path=/`, 15 minutes) and `refresh_token` ' +
      '(`Path=/auth/refresh`, 30 days).',
    headers: {
      'Set-Cookie': {
        description: 'Two headers: `access_token=...` and `refresh_token=...`.',
        schema: { type: 'string' },
      },
    },
  });

/** 503 that may carry the saved attempt (after an email failure). */
export const ApiLoginUnavailableResponse = (description: string) =>
  ApiResponse({
    status: 503,
    type: LoginUnavailableErrorDto,
    description: `\`service_unavailable\`: ${description} No cookies are set.`,
  });
