import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
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

  @ApiProperty({
    minLength: 8,
    maxLength: 128,
    example: 'secret12',
    description: 'At least one letter (any alphabet) and one digit.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/\p{L}/u, { message: 'password must contain at least one letter' })
  @Matches(/\d/, { message: 'password must contain at least one digit' })
  password: string;
}
