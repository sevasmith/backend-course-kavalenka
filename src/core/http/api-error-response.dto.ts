import { ApiProperty } from '@nestjs/swagger';

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
