import { applyDecorators } from '@nestjs/common';
import { ApiHeader, ApiNoContentResponse, ApiResponse } from '@nestjs/swagger';

import { CSRF_HEADER } from '@/core/http/csrf.guard';
import { ApiErrorResponse } from '@/core/http/openapi';
import {
  LoginUnavailableErrorDto,
  RateLimitErrorDto,
} from './dto/login-responses.dto';

/**
 * OpenAPI helpers for the auth routes. The cookies are `HttpOnly`, so a
 * client never reads them: it only has to keep them (`credentials:
 * "include"` in a browser, a cookie jar in an HTTP client).
 */

/** What every auth POST shares: the CSRF header and its 403. */
export const ApiAuthPost = () =>
  applyDecorators(
    ApiHeader({
      name: CSRF_HEADER,
      required: false,
      schema: { type: 'string', enum: ['1'] },
      description:
        'Required, with the value `1`, on a request from another origin ' +
        '(a trusted frontend). Not needed from the same origin.',
    }),
    ApiErrorResponse(
      403,
      '`csrf_rejected`: a request from another origin that is not trusted ' +
        `or has no \`${CSRF_HEADER}: 1\`.`,
    ),
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

/** 429 with `retryAfterSeconds` when a wait is known. */
export const ApiRateLimitResponse = (description: string) =>
  ApiResponse({
    status: 429,
    type: RateLimitErrorDto,
    description: `\`rate_limit_exceeded\`: ${description}`,
  });

/** 503 that may carry the saved attempt (after an email failure). */
export const ApiLoginUnavailableResponse = (description: string) =>
  ApiResponse({
    status: 503,
    type: LoginUnavailableErrorDto,
    description: `\`service_unavailable\`: ${description} No cookies are set.`,
  });
