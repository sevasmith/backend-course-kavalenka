import { ApiProperty } from '@nestjs/swagger';

import { UserStatus } from '@/modules/users/user.types';
import { RegisterPendingResult, RegisterResult } from '../auth.types';
import { RegistrationChallengeMethod } from '../registration-challenge.types';

/**
 * Classes for the OpenAPI document only (Swagger can't read the
 * `auth.types` interfaces at runtime); `implements` keeps them in sync.
 */

/** The safe profile: 201 of `POST /auth/register`, 200 of confirm. */
export class RegisterResultDto implements RegisterResult {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'email', example: 'user@example.com' })
  email: string;

  @ApiProperty({
    enum: Object.values(UserStatus),
    example: UserStatus.ACTIVE,
  })
  status: UserStatus;
}

/** 202 of `POST /auth/register` and `POST /auth/register/resend`. */
export class RegisterPendingResultDto implements RegisterPendingResult {
  @ApiProperty({ enum: [true], example: true })
  confirmationRequired: true;

  @ApiProperty({
    enum: Object.values(RegistrationChallengeMethod),
    example: RegistrationChallengeMethod.OTP,
    description:
      'Chosen by the server (`REGISTRATION_EMAIL_CONFIRMATION_METHOD`).',
  })
  method: RegistrationChallengeMethod;

  @ApiProperty({ format: 'uuid' })
  attemptId: string;

  @ApiProperty({ example: 600, description: 'The code or link lifetime.' })
  expiresInSeconds: number;

  @ApiProperty({ example: 60, description: 'When a resend is allowed.' })
  resendAfterSeconds: number;
}
