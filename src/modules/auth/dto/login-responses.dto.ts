import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ErrorCode, ErrorResponseBody } from '@/core/http/api-error';
import { LoginConfirmationRequired, LoginResendResult } from '../auth.types';
import { LoginChallengeMethod } from '../login-challenge.types';

/**
 * Classes for the OpenAPI document only: Swagger reads classes at runtime,
 * and the `auth.types` interfaces don't exist at runtime. `implements` keeps
 * them in sync: a field added to the interface breaks the build here.
 */

/** The 202 body of `POST /auth/login` when the email step is on. */
export class LoginConfirmationRequiredDto implements LoginConfirmationRequired {
  @ApiProperty({ enum: [true], example: true })
  confirmationRequired: true;

  @ApiProperty({
    enum: Object.values(LoginChallengeMethod),
    example: LoginChallengeMethod.OTP,
    description: 'Chosen by the server (`LOGIN_EMAIL_CONFIRMATION_METHOD`).',
  })
  method: LoginChallengeMethod;

  @ApiProperty({ format: 'uuid' })
  attemptId: string;

  @ApiProperty({ example: 600, description: 'The code or link lifetime.' })
  expiresInSeconds: number;

  @ApiProperty({ example: 60, description: 'When a resend is allowed.' })
  resendAfterSeconds: number;
}

/** The 202 body of `POST /auth/login/resend`: no `confirmationRequired`. */
export class LoginResendResultDto implements LoginResendResult {
  @ApiProperty({
    enum: Object.values(LoginChallengeMethod),
    example: LoginChallengeMethod.OTP,
  })
  method: LoginChallengeMethod;

  @ApiProperty({
    format: 'uuid',
    description: 'The same attempt: resend does not create a new one.',
  })
  attemptId: string;

  @ApiProperty({ example: 600 })
  expiresInSeconds: number;

  @ApiProperty({ example: 60 })
  resendAfterSeconds: number;
}

/**
 * The 503 body. When the email failed after the attempt was saved (login or
 * resend), it also carries the attempt, never the code or link. A database
 * or signing failure has only the shared fields.
 */
export class LoginUnavailableErrorDto implements ErrorResponseBody {
  @ApiProperty({ example: 503 })
  statusCode: number;

  @ApiProperty({
    enum: [ErrorCode.SERVICE_UNAVAILABLE],
    example: ErrorCode.SERVICE_UNAVAILABLE,
  })
  code: ErrorCode;

  @ApiProperty({ example: 'Service is temporarily unavailable' })
  message: string;

  @ApiPropertyOptional({
    enum: [true],
    description: 'Only after an email failure: the attempt exists.',
  })
  confirmationRequired?: true;

  @ApiPropertyOptional({ enum: Object.values(LoginChallengeMethod) })
  method?: LoginChallengeMethod;

  @ApiPropertyOptional({ format: 'uuid' })
  attemptId?: string;

  @ApiPropertyOptional({
    example: 60,
    description: 'Seconds until a resend or a new login can send an email.',
  })
  retryAfterSeconds?: number;
}
