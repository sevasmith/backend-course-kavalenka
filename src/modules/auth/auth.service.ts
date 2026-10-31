import { Injectable, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@/core/config/config.service';
import { PasswordService } from './password.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { RegisterResult } from './auth.types';
import { UserStatus } from '../users/user.types';

@Injectable()
export class AuthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly passwordService: PasswordService,
    private readonly usersService: UsersService,
  ) {}

  async register(dto: RegisterDto): Promise<RegisterResult> {
    const confirmationEnabled = this.configService.get(
      'REGISTRATION_EMAIL_CONFIRMATION_ENABLED',
    );

    if (confirmationEnabled) {
      // TODO(1.0 scenario 2): create a pending user and a confirmation attempt,
      // send the code or link and return 202.
      throw new NotImplementedException(
        'Registration with email confirmation is not implemented yet',
      );
    }

    const passwordHash = await this.passwordService.hash(dto.password);
    const user = await this.usersService.createUser({
      email: dto.email,
      passwordHash,
      status: UserStatus.ACTIVE,
    });

    return { id: user.id, email: user.email, status: user.status };
  }
}
