import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';

/**
 * The email is normalized the same way as in `RegisterDto`, so it matches the
 * stored address.
 */
export class ResendRegistrationDto {
  @ApiProperty({
    format: 'email',
    maxLength: 254,
    example: 'user@example.com',
    description: 'Trimmed and lowercased before validation.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email: string;
}
