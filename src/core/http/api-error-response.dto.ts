import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ErrorCode, ErrorResponseBody } from './api-error';

/**
 * `ErrorResponseBody` as a class, for the OpenAPI document only: Swagger
 * reads classes at runtime, and an interface doesn't exist at runtime.
 */
export class ApiErrorResponseDto implements ErrorResponseBody {
  @ApiProperty({ example: 403 })
  statusCode: number;

  @ApiProperty({
    enum: Object.values(ErrorCode),
    example: ErrorCode.PERMISSION_DENIED,
  })
  code: ErrorCode;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    description: 'An array only for validation errors (400).',
    example: 'Forbidden resource',
  })
  message: string | string[];
}

/**
 * A 429 body: the shared error fields plus the wait, when it is known. The
 * shared fields are repeated instead of extending `ApiErrorResponseDto`, so
 * the examples can show this status and code.
 */
export class RateLimitErrorDto implements ErrorResponseBody {
  @ApiProperty({ example: 429 })
  statusCode: number;

  @ApiProperty({
    enum: [ErrorCode.RATE_LIMIT_EXCEEDED],
    example: ErrorCode.RATE_LIMIT_EXCEEDED,
  })
  code: ErrorCode;

  @ApiProperty({ example: 'Too many requests, try again later' })
  message: string;

  @ApiPropertyOptional({
    example: 42,
    description:
      'Seconds until a retry can pass. Missing when no wait helps, e.g. ' +
      'the code entries are exhausted: start over instead.',
  })
  retryAfterSeconds?: number;
}
