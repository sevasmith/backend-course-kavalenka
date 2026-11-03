import { Injectable } from '@nestjs/common';
import { Transactional } from 'typeorm-transactional';
import { ConfigService } from '@/core/config/config.service';
import { PasswordService } from './password.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { RegisterPendingResult, RegisterResult } from './auth.types';
import { UserStatus } from '../users/user.types';
import { RegistrationChallengeService } from './registration-challenge.service';
import {
  REGISTRATION_CHALLENGE_RESEND_AFTER_SECONDS,
  REGISTRATION_CHALLENGE_TTL_SECONDS,
} from './registration-challenge.types';

@Injectable()
export class AuthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly passwordService: PasswordService,
    private readonly usersService: UsersService,
    private readonly registrationChallengeService: RegistrationChallengeService,
  ) {}

  async register(
    dto: RegisterDto,
  ): Promise<RegisterResult | RegisterPendingResult> {
    const confirmationEnabled = this.configService.get(
      'REGISTRATION_EMAIL_CONFIRMATION_ENABLED',
    );
    const passwordHash = await this.passwordService.hash(dto.password);

    if (confirmationEnabled) {
      return this.registerPending(dto.email, passwordHash);
    }

    const user = await this.usersService.createUser({
      email: dto.email,
      passwordHash,
      status: UserStatus.ACTIVE,
    });

    return { id: user.id, email: user.email, status: user.status };
  }

  /**
   * Creates the pending user and its confirmation attempt in one transaction:
   * if saving the attempt fails, the user is rolled back too.
   */
  @Transactional()
  private async registerPending(
    email: string,
    passwordHash: string,
  ): Promise<RegisterPendingResult> {
    const method = this.configService.get(
      'REGISTRATION_EMAIL_CONFIRMATION_METHOD',
    );

    const user = await this.usersService.createUser({
      email,
      passwordHash,
      status: UserStatus.PENDING,
    });
    // TODO(1.0 scenario 2): send `secret` by email.
    const { challenge } = await this.registrationChallengeService.create(
      user.id,
      method,
    );

    return {
      confirmationRequired: true,
      method: challenge.method,
      attemptId: challenge.id,
      expiresInSeconds: REGISTRATION_CHALLENGE_TTL_SECONDS,
      resendAfterSeconds: REGISTRATION_CHALLENGE_RESEND_AFTER_SECONDS,
    };
  }
}
