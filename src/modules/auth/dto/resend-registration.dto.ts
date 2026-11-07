import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';

/**
 * The email is normalized the same way as in `RegisterDto`, so it matches the
 * stored address.
 */
export class ResendRegistrationDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email: string;
}
