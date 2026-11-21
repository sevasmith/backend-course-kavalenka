import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * The email is normalized the same way as in `RegisterDto`, so it matches the
 * stored address. The password is checked, not set: no strength rules and no
 * trimming, every character counts.
 */
export class LoginDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email: string;

  // The upper bound matches registration: a longer password can never match,
  // and it keeps a huge body from reaching the expensive hash check.
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}
