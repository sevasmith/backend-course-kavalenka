import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateBy,
  ValidateIf,
  ValidationOptions,
} from 'class-validator';

const BOTH_FORMS_MESSAGE = 'send either attemptId and code, or token, not both';

/**
 * Rejects the token when attemptId or code is sent too: the two forms of the
 * body must not be mixed.
 */
function IsNotSentWithOtpFields(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isNotSentWithOtpFields',
      validator: {
        validate: (_value, args) => {
          const dto = args?.object as ConfirmLoginDto;
          return dto.attemptId === undefined && dto.code === undefined;
        },
        defaultMessage: () => BOTH_FORMS_MESSAGE,
      },
    },
    options,
  );
}

/**
 * Body of `POST /auth/login/confirm`, two forms:
 * - OTP: `{ attemptId, code }`;
 * - magic link: `{ token }`, where the token is `attemptId.secret`.
 *
 * Exactly one form must be sent. The DTO checks only the characters and the
 * length of the token; `LoginChallengeService.parseMagicLinkToken` checks its
 * exact shape (UUID, dot, 43 base64url characters).
 */
export class ConfirmLoginDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'OTP form only, together with `code`.',
  })
  @ValidateIf((dto: ConfirmLoginDto) => dto.token === undefined)
  @IsUUID(undefined, { message: 'attemptId must be a UUID' })
  attemptId?: string;

  @ApiPropertyOptional({
    pattern: '^\\d{6}$',
    example: '123456',
    description: 'OTP form only: the 6-digit code from the email.',
  })
  @ValidateIf((dto: ConfirmLoginDto) => dto.token === undefined)
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code?: string;

  @ApiPropertyOptional({
    maxLength: 128,
    description:
      'Magic link form only: `attemptId.secret` from the link fragment ' +
      '(after `#`). Never sent together with `attemptId` or `code`.',
  })
  @ValidateIf(
    (dto: ConfirmLoginDto) =>
      dto.token !== undefined ||
      (dto.attemptId === undefined && dto.code === undefined),
  )
  @IsString()
  @IsNotEmpty()
  // The real token is 36 + 1 + 43 = 80 characters; the cap only stops huge
  // strings early.
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9_.-]+$/, {
    message: 'token must be in the format attemptId.secret',
  })
  @IsNotSentWithOtpFields()
  token?: string;
}
