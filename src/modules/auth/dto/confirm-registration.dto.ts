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
          const dto = args?.object as ConfirmRegistrationDto;
          return dto.attemptId === undefined && dto.code === undefined;
        },
        defaultMessage: () => BOTH_FORMS_MESSAGE,
      },
    },
    options,
  );
}

/**
 * Two forms of the body:
 * - OTP: `{ attemptId, code }`;
 * - magic link: `{ token }`.
 *
 * Exactly one form must be sent. With no token, the OTP fields are required.
 * With a token, the OTP fields must be absent.
 */
export class ConfirmRegistrationDto {
  @ValidateIf((dto: ConfirmRegistrationDto) => dto.token === undefined)
  @IsUUID(undefined, { message: 'attemptId must be a UUID' })
  attemptId?: string;

  @ValidateIf((dto: ConfirmRegistrationDto) => dto.token === undefined)
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code?: string;

  @ValidateIf(
    (dto: ConfirmRegistrationDto) =>
      dto.token !== undefined ||
      (dto.attemptId === undefined && dto.code === undefined),
  )
  @IsString()
  @IsNotEmpty()
  // The real token is 43 characters; the cap only stops huge strings early.
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'token must be a base64url string' })
  @IsNotSentWithOtpFields()
  token?: string;
}
