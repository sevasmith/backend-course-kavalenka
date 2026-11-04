import {
  BadRequestException,
  HttpException,
  HttpStatus,
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
import { ConfirmRegistrationDto } from './dto/confirm-registration.dto';
import { ResendRegistrationDto } from './dto/resend-registration.dto';
import {
  ConfirmationOutcome,
  ConfirmRegistrationResult,
  RegisterPendingResult,
  RegisterResult,
} from './auth.types';
import { UserStatus } from '../users/user.types';
import { RegistrationChallengeService } from './registration-challenge.service';
import { RegistrationChallenge } from './registration-challenge.entity';
import {
  INVALID_REGISTRATION_CONFIRMATION_MESSAGE,
  REGISTRATION_ATTEMPTS_EXHAUSTED_MESSAGE,
  REGISTRATION_CHALLENGE_MAX_ATTEMPTS,
  REGISTRATION_CHALLENGE_RESEND_AFTER_SECONDS,
  REGISTRATION_CHALLENGE_TTL_SECONDS,
  REGISTRATION_RESEND_TOO_SOON_MESSAGE,
  RegistrationChallengeConsumedReason,
  RegistrationChallengeMethod,
} from './registration-challenge.types';

/**
 * Statuses that consume an open attempt with `user_inactive`: the user was
 * blocked or deleted before confirming.
 */
const INACTIVE_USER_STATUSES: readonly UserStatus[] = [
  UserStatus.BLOCKED,
  UserStatus.DELETING,
  UserStatus.DELETED,
];

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
   * The checks and writes run in `applyConfirmation` (one transaction). This
   * method turns its outcome into a response only after the commit: throwing
   * the 400 inside the transaction would roll back the wrong-code counter and
   * make brute force unlimited.
   */
  async confirmRegistration(
    dto: ConfirmRegistrationDto,
  ): Promise<ConfirmRegistrationResult> {
    const outcome = await this.applyConfirmation(dto);

    if (outcome.confirmed) {
      this.logger.log(
        `Registration confirmed, attemptId=${outcome.attemptId}, userId=${outcome.user.id}`,
      );
      return outcome.user;
    }

    const { reason, attemptId, userId, attempts } = outcome;
    this.logger.warn(
      `Registration confirmation failed, reason=${reason}, ` +
        `attemptId=${attemptId ?? 'unknown'}, userId=${userId ?? 'unknown'}` +
        (attempts !== undefined
          ? `, attempts=${attempts}/${REGISTRATION_CHALLENGE_MAX_ATTEMPTS}`
          : ''),
    );

    if (reason === 'attempts_exhausted') {
      throw new HttpException(
        REGISTRATION_ATTEMPTS_EXHAUSTED_MESSAGE,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    throw new BadRequestException(INVALID_REGISTRATION_CONFIRMATION_MESSAGE);
  }

  /**
   * One transaction. The attempt row is locked first (`SELECT ... FOR
   * UPDATE`), so parallel requests for the same attempt run one after another:
   * two of them cannot both succeed, and parallel wrong guesses cannot skip
   * the limit. Returns the outcome instead of throwing, so every write here
   * (counter, consumption, activation) is committed.
   *
   * The method comes from the saved attempt, not from the config: an issued
   * attempt stays valid even if the confirmation flag or method changes.
   */
  @Transactional()
  private async applyConfirmation(
    dto: ConfirmRegistrationDto,
  ): Promise<ConfirmationOutcome> {
    const challenge =
      dto.token !== undefined
        ? await this.registrationChallengeService.findMagicLinkAttemptForUpdate(
            dto.token,
          )
        : await this.registrationChallengeService.findOtpAttemptForUpdate(
            dto.attemptId!,
          );

    if (!challenge) {
      return {
        confirmed: false,
        reason: 'not_found',
        attemptId: dto.attemptId,
      };
    }

    const attemptId = challenge.id;
    const userId = challenge.userId;

    // Consumed: after five wrong codes it is 429 (even for the correct code),
    // otherwise (confirmed, replaced, user_inactive) the shared 400.
    if (challenge.consumedAt !== null) {
      const reason =
        challenge.consumedReason ===
        RegistrationChallengeConsumedReason.ATTEMPTS_EXHAUSTED
          ? 'attempts_exhausted'
          : 'consumed';
      return { confirmed: false, reason, attemptId, userId };
    }

    // Expired: rejected without counting an entry.
    if (challenge.expiresAt.getTime() <= Date.now()) {
      return { confirmed: false, reason: 'expired', attemptId, userId };
    }

    // Defensive: the fifth wrong entry already consumes the attempt.
    if (challenge.attempts >= REGISTRATION_CHALLENGE_MAX_ATTEMPTS) {
      return {
        confirmed: false,
        reason: 'attempts_exhausted',
        attemptId,
        userId,
      };
    }

    // A magic link attempt was found by this HMAC, so it always matches here;
    // it still goes through the same path.
    const secret = dto.token ?? dto.code!;
    if (!this.registrationChallengeService.secretMatches(challenge, secret)) {
      const { attempts } =
        await this.registrationChallengeService.registerWrongSecret(challenge);
      return {
        confirmed: false,
        reason: 'wrong_secret',
        attemptId,
        userId,
        attempts,
      };
    }

    const user = await this.usersService.findByIdForUpdate(userId);
    if (user?.status !== UserStatus.PENDING) {
      // Blocked or deleted before confirming: the attempt can never succeed.
      // Any other status (e.g. already active) is left as it is.
      if (user && INACTIVE_USER_STATUSES.includes(user.status)) {
        await this.registrationChallengeService.consume(
          challenge,
          RegistrationChallengeConsumedReason.USER_INACTIVE,
        );
      }
      return {
        confirmed: false,
        reason: 'user_not_pending',
        attemptId,
        userId,
      };
    }

    await this.usersService.updateStatus(user.id, UserStatus.ACTIVE);
    await this.registrationChallengeService.consume(
      challenge,
      RegistrationChallengeConsumedReason.CONFIRMED,
    );

    return {
      confirmed: true,
      attemptId,
      user: { id: user.id, email: user.email, status: UserStatus.ACTIVE },
    };
  }

  /**
   * Like `register`, the email goes out only after the transaction commits:
   * if it fails, the new attempt stays and the client gets a 503.
   */
  async resendRegistration(
    dto: ResendRegistrationDto,
  ): Promise<RegisterPendingResult> {
    const { result, secret } = await this.replaceChallenge(dto.email);
    await this.sendRegistrationEmail(dto.email, result, secret);
    return result;
  }

  /**
   * One transaction: consumes the newest attempt as `replaced` (its code or
   * token stops working) and creates a new one with a fresh TTL and counter.
   * Rejections happen before any write, so throwing here rolls back nothing.
   *
   * Locks the attempt first, then the user: the same order as
   * `applyConfirmation`, so a resend and a confirmation cannot deadlock.
   *
   * The method comes from the old attempt, not from the config, and the flag
   * is not checked: an issued attempt can be resent even if they changed.
   */
  @Transactional()
  private async replaceChallenge(
    email: string,
  ): Promise<{ result: RegisterPendingResult; secret: string }> {
    const user = await this.usersService.findByEmail(email);
    const challenge = user
      ? await this.registrationChallengeService.findLatestForUserForUpdate(
          user.id,
        )
      : null;

    // A parallel resend replaced this attempt while we waited for the lock:
    // an email was just sent, so it is the same as a resend that is too soon.
    if (
      challenge?.consumedReason === RegistrationChallengeConsumedReason.REPLACED
    ) {
      this.logRejectedResend('too_soon', challenge.id);
      throw new HttpException(
        REGISTRATION_RESEND_TOO_SOON_MESSAGE,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const lockedUser = challenge
      ? await this.usersService.findByIdForUpdate(challenge.userId)
      : null;

    // Unknown email, no attempt, or the user is no longer pending (already
    // confirmed, blocked, deleted): the same 400 as for a confirmation.
    if (!challenge || lockedUser?.status !== UserStatus.PENDING) {
      this.logRejectedResend('not_pending', challenge?.id);
      throw new BadRequestException(INVALID_REGISTRATION_CONFIRMATION_MESSAGE);
    }

    const resendAllowedAt =
      challenge.lastSentAt.getTime() +
      REGISTRATION_CHALLENGE_RESEND_AFTER_SECONDS * 1000;
    if (Date.now() < resendAllowedAt) {
      this.logRejectedResend('too_soon', challenge.id);
      throw new HttpException(
        REGISTRATION_RESEND_TOO_SOON_MESSAGE,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Also for an attempt already consumed after five wrong codes: `replaced`
    // is what tells a parallel resend waiting on this lock to stop.
    await this.registrationChallengeService.consume(
      challenge,
      RegistrationChallengeConsumedReason.REPLACED,
    );
    const created = await this.registrationChallengeService.create(
      lockedUser.id,
      challenge.method,
    );

    this.logger.log(
      `Registration attempt replaced, oldAttemptId=${challenge.id}, ` +
        `attemptId=${created.challenge.id}, userId=${lockedUser.id}`,
    );

    return {
      result: toPendingResult(created.challenge),
      secret: created.secret,
    };
  }

  private logRejectedResend(reason: string, attemptId?: string): void {
    this.logger.warn(
      `Registration resend rejected, reason=${reason}, attemptId=${attemptId ?? 'unknown'}`,
    );
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

    return { result: toPendingResult(challenge), secret };
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
          this.buildMagicLink(secret),
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
   * server, so opening the link cannot change state. The token is only the
   * secret: the attempt is found by its HMAC, not by an id.
   */
  private buildMagicLink(secret: string): string {
    const url = new URL(this.configService.get('REGISTRATION_CONFIRM_URL')!);
    url.hash = secret;
    return url.toString();
  }
}

/**
 * The 202 body of `register` and `resend`. The secret is never part of it.
 */
function toPendingResult(
  challenge: RegistrationChallenge,
): RegisterPendingResult {
  return {
    confirmationRequired: true,
    method: challenge.method,
    attemptId: challenge.id,
    expiresInSeconds: REGISTRATION_CHALLENGE_TTL_SECONDS,
    resendAfterSeconds: REGISTRATION_CHALLENGE_RESEND_AFTER_SECONDS,
  };
}
