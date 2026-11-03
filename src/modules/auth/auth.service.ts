import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Transactional } from 'typeorm-transactional';
import { ConfigService } from '@/core/config/config.service';
import { MailService } from '@/core/mail/mail.service';
import { PasswordService } from './password.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { RegisterPendingResult, RegisterResult } from './auth.types';
import { UserStatus } from '../users/user.types';
import { RegistrationChallengeService } from './registration-challenge.service';
import {
  REGISTRATION_CHALLENGE_RESEND_AFTER_SECONDS,
  REGISTRATION_CHALLENGE_TTL_SECONDS,
  RegistrationChallengeMethod,
} from './registration-challenge.types';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly passwordService: PasswordService,
    private readonly usersService: UsersService,
    private readonly registrationChallengeService: RegistrationChallengeService,
    private readonly mailService: MailService,
  ) {}

  async register(
    dto: RegisterDto,
  ): Promise<RegisterResult | RegisterPendingResult> {
    const confirmationEnabled = this.configService.get(
      'REGISTRATION_EMAIL_CONFIRMATION_ENABLED',
    );
    const passwordHash = await this.passwordService.hash(dto.password);

    if (confirmationEnabled) {
      // The transaction has committed by now: if the email fails, the pending
      // user and the attempt stay, and the client asks for a resend.
      const { result, secret } = await this.registerPending(
        dto.email,
        passwordHash,
      );
      await this.sendRegistrationEmail(dto.email, result, secret);
      return result;
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
  ): Promise<{ result: RegisterPendingResult; secret: string }> {
    const method = this.configService.get(
      'REGISTRATION_EMAIL_CONFIRMATION_METHOD',
    );

    const user = await this.usersService.createUser({
      email,
      passwordHash,
      status: UserStatus.PENDING,
    });
    const { challenge, secret } =
      await this.registrationChallengeService.create(user.id, method);

    return {
      result: {
        confirmationRequired: true,
        method: challenge.method,
        attemptId: challenge.id,
        expiresInSeconds: REGISTRATION_CHALLENGE_TTL_SECONDS,
        resendAfterSeconds: REGISTRATION_CHALLENGE_RESEND_AFTER_SECONDS,
      },
      secret,
    };
  }

  /**
   * Never logs the secret or the link: only the attempt id.
   */
  private async sendRegistrationEmail(
    email: string,
    { method, attemptId }: RegisterPendingResult,
    secret: string,
  ): Promise<void> {
    try {
      if (method === RegistrationChallengeMethod.OTP) {
        await this.mailService.sendRegistrationOtp(email, secret);
      } else {
        await this.mailService.sendRegistrationMagicLink(
          email,
          this.buildMagicLink(attemptId, secret),
        );
      }
    } catch (error) {
      // Nodemailer's `code` (e.g. ESOCKET) is the useful part: a refused
      // connection is an AggregateError with an empty message.
      const { code, message } = error as Error & { code?: string };
      this.logger.error(
        `Registration email failed, attemptId=${attemptId}: ${code ?? 'unknown'} ${message}`,
      );
      throw new ServiceUnavailableException(
        'Confirmation email could not be sent',
      );
    }

    this.logger.log(`Registration email sent, attemptId=${attemptId}`);
  }

  /**
   * The token goes into the fragment (#): browsers never send it to the
   * server, so opening the link cannot change state.
   */
  private buildMagicLink(attemptId: string, secret: string): string {
    const url = new URL(this.configService.get('REGISTRATION_CONFIRM_URL')!);
    url.hash = `${attemptId}.${secret}`;
    return url.toString();
  }
}
