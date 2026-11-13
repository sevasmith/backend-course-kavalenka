import { HttpStatus } from '@nestjs/common';

/** The error codes from the `task.md` table "Standardization of HTTP Responses and Error Codes". */
export const ErrorCode = {
  BAD_REQUEST: 'bad_request',
  INVALID_SESSION: 'invalid_session',
  INVALID_CREDENTIALS: 'invalid_credentials',
  PERMISSION_DENIED: 'permission_denied',
  OWNERSHIP_DENIED: 'ownership_denied',
  CSRF_REJECTED: 'csrf_rejected',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  PAYLOAD_TOO_LARGE: 'payload_too_large',
  UNSUPPORTED_MEDIA_TYPE: 'unsupported_media_type',
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  AUTHORIZATION_UNAVAILABLE: 'authorization_unavailable',
  SERVICE_UNAVAILABLE: 'service_unavailable',
  GATEWAY_TIMEOUT: 'gateway_timeout',
  /** Not in `task.md`: an unexpected error (a bug), always a neutral 500. */
  INTERNAL_ERROR: 'internal_error',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** The body of every error response. */
export interface ErrorResponseBody {
  statusCode: number;
  code: ErrorCode;
  /** An array only for DTO validation errors (one entry per failed rule). */
  message: string | string[];
}

/**
 * The code used when the thrown exception doesn't choose one. A status with
 * several codes in `task.md` (401, 403, 503) gets the most common one; the
 * others are chosen explicitly with `apiError()`.
 */
const DEFAULT_CODES: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.INVALID_SESSION,
  [HttpStatus.FORBIDDEN]: ErrorCode.PERMISSION_DENIED,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.PAYLOAD_TOO_LARGE,
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMIT_EXCEEDED,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.SERVICE_UNAVAILABLE,
  [HttpStatus.GATEWAY_TIMEOUT]: ErrorCode.GATEWAY_TIMEOUT,
};

export function defaultErrorCode(status: number): ErrorCode {
  return (
    DEFAULT_CODES[status] ??
    (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.BAD_REQUEST)
  );
}

/**
 * The response object for a Nest exception that needs a non-default code:
 * `new ServiceUnavailableException(apiError(ErrorCode.AUTHORIZATION_UNAVAILABLE, '...'))`.
 * The exception keeps its class, so `instanceof` checks still work.
 */
export function apiError(
  code: ErrorCode,
  message: string,
): { code: ErrorCode; message: string } {
  return { code, message };
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return (Object.values(ErrorCode) as unknown[]).includes(value);
}
