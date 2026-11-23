import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Transactional } from 'typeorm-transactional';
import { ConfigService } from '@/core/config/config.service';
import { MailService } from '@/core/mail/mail.service';
import { apiError, ErrorCode } from '@/core/http/api-error';
import { PasswordService } from './password.service';
import { UsersService } from '../users/users.service';
import { RbacDefaultRoleService } from '../rbac/rbac-default-role.service';
import { RegisterDto } from './dto/register.dto';
import { ConfirmRegistrationDto } from './dto/confirm-registration.dto';
import { ResendRegistrationDto } from './dto/resend-registration.dto';
import { LoginDto } from './dto/login.dto';
import { ConfirmLoginDto } from './dto/confirm-login.dto';
import { ResendLoginDto } from './dto/resend-login.dto';
import {
  AuthTokens,
  ConfirmationOutcome,
  ConfirmRegistrationResult,
  INVALID_CREDENTIALS_MESSAGE,
  INVALID_SESSION_MESSAGE,
  LoginConfirmationOutcome,
  LoginConfirmationRequired,
  LoginResendOutcome,
  LoginResendResult,
  LoginResult,
  LoginUser,
  RegisterPendingResult,
  RegisterResult,
} from './auth.types';
import { User } from '../users/user.entity';
import { UserStatus } from '../users/user.types';
import { RegistrationChallengeService } from './registration-challenge.service';
import { TokenService } from './token.service';
import { LoginAttemptLimiter } from './login-attempt-limiter';
import { RegistrationChallenge } from './registration-challenge.entity';
import { LoginChallengeService } from './login-challenge.service';
import { LoginChallenge } from './login-challenge.entity';
import {
  CreatedLoginChallenge,
  INVALID_LOGIN_CONFIRMATION_MESSAGE,
  LOGIN_ATTEMPTS_EXHAUSTED_MESSAGE,
  LOGIN_CHALLENGE_MAX_ATTEMPTS,
  LOGIN_CHALLENGE_RESEND_AFTER_SECONDS,
  LOGIN_CHALLENGE_TTL_SECONDS,
  LOGIN_EMAIL_TOO_SOON_MESSAGE,
  LoginChallengeConsumedReason,
  LoginChallengeMethod,
} from './login-challenge.types';
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
    private readonly defaultRoleService: RbacDefaultRoleService,
    private readonly tokenService: TokenService,
    private readonly loginAttemptLimiter: LoginAttemptLimiter,
    private readonly loginChallengeService: LoginChallengeService,
  ) {}

  /**
   * Logs ids and statuses only: never the email, password, hash or secret.
   */
  async register(
    dto: RegisterDto,
  ): Promise<RegisterResult | RegisterPendingResult> {
    const confirmationEnabled = this.configService.get(
      'REGISTRATION_EMAIL_CONFIRMATION_ENABLED',
    );
    const passwordHash = await this.passwordService.hash(dto.password);

    try {
      if (confirmationEnabled) {
        // The transaction has committed by now: if the email fails, the
        // pending user and the attempt stay, and the client asks for a resend.
        const { result, secret } = await this.registerPending(
          dto.email,
          passwordHash,
        );
        this.logger.log(
          `Registration created, status=${UserStatus.PENDING}, attemptId=${result.attemptId}`,
        );
        await this.sendRegistrationEmail(dto.email, result, secret);
        return result;
      }

      const user = await this.registerActive(dto.email, passwordHash);
      this.logger.log(
        `Registration created, status=${user.status}, userId=${user.id}`,
      );

      return { id: user.id, email: user.email, status: user.status };
    } catch (error) {
      if (error instanceof ConflictException) {
        this.logger.warn('Registration rejected, reason=email_taken');
      }
      throw error;
    }
  }

  /**
   * `POST /auth/login`. After the password check:
   * - `LOGIN_EMAIL_CONFIRMATION_ENABLED=false`: the token pair (204 + cookies);
   * - `true`: a login attempt and an email, no tokens yet (202).
   */
  async login(dto: LoginDto, ip: string): Promise<LoginResult> {
    // Before the hash: a blocked pair costs no Argon2 work.
    const slot = this.loginAttemptLimiter.reserve(dto.email, ip);

    let user: LoginUser;
    try {
      user = await this.checkCredentials(dto);
    } catch (error) {
      // Only a wrong login counts. Anything else (e.g. the database is
      // down) is not the client's fault, so the slot is given back.
      if (!(error instanceof UnauthorizedException)) {
        this.loginAttemptLimiter.release(slot);
      }
      throw error;
    }

    this.loginAttemptLimiter.reset(slot);

    // Read per request: a config change applies only to new logins, while an
    // issued attempt keeps its own method.
    if (this.configService.get('LOGIN_EMAIL_CONFIRMATION_ENABLED')) {
      return this.startLoginConfirmation(user.id, dto.email);
    }
    return this.signTokens(user.id);
  }

  /**
   * The second login step. The 429 pre-check runs without a lock, so a
   * client that clicks "log in" again too soon costs no transaction; the
   * transaction repeats the check under the lock, which is what makes it safe.
   *
   * The email goes out only after the commit. If it fails, the attempt stays
   * and the client gets a 503 with the attempt fields (never the secret):
   * the retry is a resend or a new login after the same 60-second pause.
   */
  private async startLoginConfirmation(
    userId: string,
    email: string,
  ): Promise<LoginConfirmationRequired> {
    let created: CreatedLoginChallenge;
    try {
      const previous =
        await this.loginChallengeService.findActiveForUser(userId);
      if (previous) {
        this.rejectLoginEmailIfTooSoon(previous);
      }
      created = await this.replaceLoginChallenge(userId);
    } catch (error) {
      // 401 and 429 are answers; anything else means the attempt was not
      // committed (e.g. the database is down) and no email was sent.
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Login attempt not created, userId=${userId}: ${(error as Error).name}`,
      );
      throw new ServiceUnavailableException(
        apiError(
          ErrorCode.SERVICE_UNAVAILABLE,
          'Login is temporarily unavailable',
        ),
      );
    }

    const result = toLoginConfirmationRequired(created.challenge);
    this.logger.log(
      `Login attempt created, method=${result.method}, attemptId=${result.attemptId}, userId=${userId}`,
    );
    await this.sendLoginEmail(email, result, created.secret);
    return result;
  }

  /**
   * One transaction. Locks the user, then the user's open attempt: the order
   * every login-attempt transaction uses (confirm and resend too), so two of
   * them can never wait for each other in a cycle (a deadlock).
   *
   * Under the lock it rechecks what the password check saw: the user is still
   * `active` (a block between the two would otherwise still get an email) and
   * the 60-second pause (a parallel login may have just sent an email).
   * Rejections happen before any write, so throwing here rolls back nothing.
   *
   * The old attempt is consumed as `replaced` before the insert: the partial
   * unique index allows only one unconsumed attempt per user.
   */
  @Transactional()
  private async replaceLoginChallenge(
    userId: string,
  ): Promise<CreatedLoginChallenge> {
    const user = await this.usersService.findByIdForUpdate(userId);
    if (user?.status !== UserStatus.ACTIVE) {
      this.logger.warn(
        `Login attempt rejected, reason=user_inactive, userId=${userId}`,
      );
      throw new UnauthorizedException(
        apiError(ErrorCode.INVALID_CREDENTIALS, INVALID_CREDENTIALS_MESSAGE),
      );
    }

    const previous =
      await this.loginChallengeService.findActiveForUserForUpdate(userId);
    if (previous) {
      this.rejectLoginEmailIfTooSoon(previous);
      await this.loginChallengeService.consume(
        previous,
        LoginChallengeConsumedReason.REPLACED,
      );
      this.logger.log(
        `Login attempt replaced, oldAttemptId=${previous.id}, userId=${userId}`,
      );
    }

    // The server picks the method; the client never chooses it.
    const method = this.configService.get('LOGIN_EMAIL_CONFIRMATION_METHOD');
    return this.loginChallengeService.create(userId, method);
  }

  /**
   * 429 with `retryAfterSeconds` while `last_sent_at + 60 s` is in the
   * future: no new attempt, no email.
   */
  private rejectLoginEmailIfTooSoon(challenge: LoginChallenge): void {
    const retryAfterSeconds =
      this.loginChallengeService.secondsUntilResend(challenge);
    if (retryAfterSeconds === 0) {
      return;
    }

    this.logger.warn(
      `Login attempt rejected, reason=too_soon, attemptId=${challenge.id}, ` +
        `userId=${challenge.userId}, retryAfterSeconds=${retryAfterSeconds}`,
    );
    throw new HttpException(
      apiError(ErrorCode.RATE_LIMIT_EXCEEDED, LOGIN_EMAIL_TOO_SOON_MESSAGE, {
        retryAfterSeconds,
      }),
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /**
   * Never logs the email, the secret or the link: only the attempt id.
   */
  private async sendLoginEmail(
    email: string,
    {
      method,
      attemptId,
    }: Pick<LoginConfirmationRequired, 'method' | 'attemptId'>,
    secret: string,
  ): Promise<void> {
    try {
      if (method === LoginChallengeMethod.OTP) {
        await this.mailService.sendLoginOtp(email, secret);
      } else {
        await this.mailService.sendLoginMagicLink(
          email,
          this.buildLoginMagicLink(attemptId, secret),
        );
      }
    } catch (error) {
      const { code, message } = error as Error & { code?: string };
      this.logger.error(
        `Login email failed, method=${method}, attemptId=${attemptId}: ${code ?? 'unknown'} ${message}`,
      );
      // The attempt is committed: the client can resend after the pause.
      throw new ServiceUnavailableException(
        apiError(
          ErrorCode.SERVICE_UNAVAILABLE,
          'Confirmation email could not be sent',
          {
            confirmationRequired: true,
            method,
            attemptId,
            retryAfterSeconds: LOGIN_CHALLENGE_RESEND_AFTER_SECONDS,
          },
        ),
      );
    }

    this.logger.log(
      `Login email sent, method=${method}, attemptId=${attemptId}`,
    );
  }

  /**
   * Unlike registration, the token is `attemptId.secret`: confirm finds the
   * attempt by its id. It goes into the fragment (#), which browsers never
   * send to the server, so opening the link changes nothing by itself.
   */
  private buildLoginMagicLink(attemptId: string, secret: string): string {
    const url = new URL(this.configService.get('LOGIN_CONFIRM_URL')!);
    url.hash = this.loginChallengeService.buildMagicLinkToken(
      attemptId,
      secret,
    );
    return url.toString();
  }

  /**
   * The password check of `POST /auth/login`. An unknown email, a wrong
   * password and any status other than `active` throw the same 401, so the
   * response never tells whether the account exists or what state it is in.
   *
   * An unknown email still runs a full Argon2 check (against the dummy hash),
   * so it takes about as long as a wrong password. The status is checked
   * after the password, so a wrong password for a blocked user and for an
   * active user follow the same path.
   */
  async checkCredentials(dto: LoginDto): Promise<LoginUser> {
    const user = await this.usersService.findByEmail(dto.email);

    const passwordMatches = user
      ? await this.passwordService.verify(user.passwordHash, dto.password)
      : await this.passwordService.verifyDummy(dto.password);

    if (!user || !passwordMatches || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(
        apiError(ErrorCode.INVALID_CREDENTIALS, INVALID_CREDENTIALS_MESSAGE),
      );
    }

    return { id: user.id };
  }

  /**
   * Signs both tokens before anything is sent: if either fails, the caller
   * gets a 503 and sets no cookies, so the client never holds half a pair.
   * Refresh (task 13) and the login confirmation (task 11) reuse this.
   */
  private signTokens(userId: string): AuthTokens {
    try {
      return {
        accessToken: this.tokenService.signAccess(userId),
        refreshToken: this.tokenService.signRefresh(userId),
      };
    } catch (error) {
      // Only the error name: the message could contain claims or key details.
      this.logger.error(
        `Token signing failed, userId=${userId}: ${(error as Error).name}`,
      );
      throw new ServiceUnavailableException(
        apiError(
          ErrorCode.SERVICE_UNAVAILABLE,
          'Login is temporarily unavailable',
        ),
      );
    }
  }

  /**
   * `POST /auth/refresh`: a new token pair for a valid refresh token whose
   * user still exists and is `active` (1.2 §1.3.4).
   *
   * Stateless rotation: nothing is stored or revoked, so the used refresh
   * token stays valid until its own `exp`. Reading the user on every refresh
   * is what stops a blocked or deleted user.
   *
   * - bad token, missing or non-active user: one 401 `invalid_session`, the
   *   reason only in the log;
   * - database down: 503, not 401 (the session may be fine);
   * - signing fails: 503 from `signTokens`, so no cookies are set and the old
   *   refresh cookie still works for a retry.
   */
  async refresh(refreshToken: string | undefined): Promise<AuthTokens> {
    const verification = this.tokenService.verifyRefresh(refreshToken);
    if (!verification.ok) {
      this.rejectRefresh(verification.reason);
    }

    const { userId } = verification;
    let user: Pick<User, 'id' | 'status'> | null;
    try {
      user = await this.usersService.findStatusById(userId);
    } catch (error) {
      this.logger.error(
        `Refresh failed, reason=database, userId=${userId}: ${(error as Error).name}`,
      );
      throw new ServiceUnavailableException(
        apiError(
          ErrorCode.SERVICE_UNAVAILABLE,
          'Session refresh is temporarily unavailable',
        ),
      );
    }

    if (!user) {
      this.rejectRefresh('user_missing', userId);
    }
    if (user.status !== UserStatus.ACTIVE) {
      this.rejectRefresh(`user_${user.status}`, userId);
    }

    const tokens = this.signTokens(userId);
    this.logger.log(`Refresh succeeded, userId=${userId}`);
    return tokens;
  }

  /** Logs the reason (never the token) and throws the shared 401. */
  private rejectRefresh(reason: string, userId?: string): never {
    this.logger.warn(
      `Refresh rejected, reason=${reason}, userId=${userId ?? 'unknown'}`,
    );
    throw new UnauthorizedException(
      apiError(ErrorCode.INVALID_SESSION, INVALID_SESSION_MESSAGE),
    );
  }

  /**
   * `POST /auth/login/confirm`. The checks and writes run in
   * `applyLoginConfirmation` (one transaction); this method turns its outcome
   * into a response only after the commit, so the wrong-code counter and the
   * `user_inactive` consumption are saved even though the client gets an error.
   *
   * The tokens are returned only after the commit: if the commit fails, no
   * cookies are set and the attempt (rolled back) can be confirmed again.
   */
  async confirmLogin(dto: ConfirmLoginDto): Promise<AuthTokens> {
    let outcome: LoginConfirmationOutcome;
    try {
      outcome = await this.applyLoginConfirmation(dto);
    } catch (error) {
      // The 503 of a failed signature is already an answer.
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Login confirmation failed, reason=database: ${(error as Error).name}`,
      );
      throw new ServiceUnavailableException(
        apiError(
          ErrorCode.SERVICE_UNAVAILABLE,
          'Login is temporarily unavailable',
        ),
      );
    }

    if (outcome.confirmed) {
      this.logger.log(
        `Login confirmed, attemptId=${outcome.attemptId}, userId=${outcome.userId}`,
      );
      return outcome.tokens;
    }

    const { reason, attemptId, userId, attempts } = outcome;
    this.logger.warn(
      `Login confirmation rejected, reason=${reason}, ` +
        `attemptId=${attemptId ?? 'unknown'}, userId=${userId ?? 'unknown'}` +
        (attempts !== undefined
          ? `, attempts=${attempts}/${LOGIN_CHALLENGE_MAX_ATTEMPTS}`
          : ''),
    );

    if (reason === 'attempts_exhausted') {
      throw new HttpException(
        apiError(
          ErrorCode.RATE_LIMIT_EXCEEDED,
          LOGIN_ATTEMPTS_EXHAUSTED_MESSAGE,
        ),
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (reason === 'user_inactive') {
      throw new UnauthorizedException(
        apiError(ErrorCode.INVALID_CREDENTIALS, INVALID_CREDENTIALS_MESSAGE),
      );
    }
    throw new BadRequestException(
      apiError(ErrorCode.BAD_REQUEST, INVALID_LOGIN_CONFIRMATION_MESSAGE),
    );
  }

  /**
   * One transaction, in the order of 1.2 §1.3.2:
   * 1. Read the attempt without a lock, only to learn `user_id`.
   * 2. Lock the user, then the attempt (the order of every login-attempt
   *    transaction, so they never deadlock), and re-read the attempt: a
   *    parallel request may have changed it while we waited.
   * 3. Consumed (429 for `attempts_exhausted`, else 400) and expired (400,
   *    no counter) are rejected before the user and the secret are checked.
   * 4. A user who is gone or not `active` consumes it as `user_inactive`.
   * 5. Only then the secret: a wrong OTP is counted, a wrong link is not.
   * 6. On a match, sign both tokens first (a failure throws and rolls back),
   *    then consume the attempt as `confirmed`.
   *
   * The method comes from the saved attempt, not from the config.
   */
  @Transactional()
  private async applyLoginConfirmation(
    dto: ConfirmLoginDto,
  ): Promise<LoginConfirmationOutcome> {
    const target = this.parseLoginConfirmation(dto);
    if (!target) {
      return { confirmed: false, reason: 'not_found' };
    }

    const found = await this.loginChallengeService.findById(target.attemptId);
    if (!found) {
      return {
        confirmed: false,
        reason: 'not_found',
        attemptId: target.attemptId,
      };
    }

    const userId = found.userId;
    const user = await this.usersService.findByIdForUpdate(userId);
    const challenge = await this.loginChallengeService.findByIdForUpdate(
      found.id,
    );
    if (!challenge) {
      return { confirmed: false, reason: 'not_found', attemptId: found.id };
    }

    const attemptId = challenge.id;

    // A code sent for a magic link attempt (or a token for an OTP one).
    if (challenge.method !== target.method) {
      return { confirmed: false, reason: 'wrong_method', attemptId, userId };
    }

    if (challenge.consumedAt !== null) {
      const reason =
        challenge.consumedReason ===
        LoginChallengeConsumedReason.ATTEMPTS_EXHAUSTED
          ? 'attempts_exhausted'
          : 'consumed';
      return { confirmed: false, reason, attemptId, userId };
    }

    // `last_sent_at + 10 min`. Rejected without counting an entry.
    if (this.loginChallengeService.isExpired(challenge)) {
      return { confirmed: false, reason: 'expired', attemptId, userId };
    }

    // Blocked or deleted after the password check: the attempt can never
    // succeed, so it is closed for good.
    if (user?.status !== UserStatus.ACTIVE) {
      await this.loginChallengeService.consume(
        challenge,
        LoginChallengeConsumedReason.USER_INACTIVE,
      );
      return { confirmed: false, reason: 'user_inactive', attemptId, userId };
    }

    if (!this.loginChallengeService.secretMatches(challenge, target.secret)) {
      // A 6-digit code can be guessed, so it is counted; 32 random bytes
      // cannot, so a wrong link is not.
      if (challenge.method === LoginChallengeMethod.OTP) {
        const { attempts } =
          await this.loginChallengeService.registerWrongOtp(challenge);
        return {
          confirmed: false,
          reason: 'wrong_secret',
          attemptId,
          userId,
          attempts,
        };
      }
      return { confirmed: false, reason: 'wrong_secret', attemptId, userId };
    }

    const tokens = this.signTokens(userId);
    await this.loginChallengeService.consume(
      challenge,
      LoginChallengeConsumedReason.CONFIRMED,
    );
    return { confirmed: true, attemptId, userId, tokens };
  }

  /**
   * Which attempt, which secret and which method the body is for. Null for a
   * token that is not `attemptId.secret`: the same 400 as an unknown attempt,
   * without a database query.
   */
  private parseLoginConfirmation(dto: ConfirmLoginDto): {
    attemptId: string;
    secret: string;
    method: LoginChallengeMethod;
  } | null {
    if (dto.token !== undefined) {
      const parsed = this.loginChallengeService.parseMagicLinkToken(dto.token);
      return parsed && { ...parsed, method: LoginChallengeMethod.MAGIC_LINK };
    }
    return {
      attemptId: dto.attemptId!,
      secret: dto.code!,
      method: LoginChallengeMethod.OTP,
    };
  }

  /**
   * `POST /auth/login/resend`. The checks and the new secret are committed
   * in `applyLoginResend`; the email goes out only after the commit. If SMTP
   * fails, the new hash stays (the old secret is not restored) and the next
   * resend is possible after 60 seconds.
   */
  async resendLogin(dto: ResendLoginDto): Promise<LoginResendResult> {
    let outcome: LoginResendOutcome;
    try {
      outcome = await this.applyLoginResend(dto.attemptId);
    } catch (error) {
      this.logger.error(
        `Login resend failed, reason=database, attemptId=${dto.attemptId}: ${(error as Error).name}`,
      );
      throw new ServiceUnavailableException(
        apiError(
          ErrorCode.SERVICE_UNAVAILABLE,
          'Login is temporarily unavailable',
        ),
      );
    }

    if (!outcome.resent) {
      this.rejectLoginResend(outcome);
    }

    const { challenge, secret, email } = outcome;
    this.logger.log(
      `Login attempt resent, method=${challenge.method}, attemptId=${challenge.id}, userId=${challenge.userId}`,
    );
    await this.sendLoginEmail(
      email,
      { method: challenge.method, attemptId: challenge.id },
      secret,
    );

    return {
      method: challenge.method,
      attemptId: challenge.id,
      expiresInSeconds: LOGIN_CHALLENGE_TTL_SECONDS,
      resendAfterSeconds: LOGIN_CHALLENGE_RESEND_AFTER_SECONDS,
    };
  }

  /**
   * One transaction, in the order of 1.2 §1.3.2 (resend):
   * 1. Read the attempt without a lock, only to learn `user_id`.
   * 2. Lock the user, then the attempt, and re-read it.
   * 3. Consumed: 429 for `attempts_exhausted`, else 400. An expired TTL is
   *    fine: resend is how an expired attempt gets a new secret.
   * 4. A user who is gone or not `active` consumes it as `user_inactive`.
   * 5. The 60-second pause, counted from `last_sent_at`.
   * 6. A new secret of the saved method in the same row.
   */
  @Transactional()
  private async applyLoginResend(
    attemptId: string,
  ): Promise<LoginResendOutcome> {
    const found = await this.loginChallengeService.findById(attemptId);
    if (!found) {
      return { resent: false, reason: 'not_found', attemptId };
    }

    const userId = found.userId;
    const user = await this.usersService.findByIdForUpdate(userId);
    const challenge =
      await this.loginChallengeService.findByIdForUpdate(attemptId);
    if (!challenge) {
      return { resent: false, reason: 'not_found', attemptId };
    }

    if (challenge.consumedAt !== null) {
      const reason =
        challenge.consumedReason ===
        LoginChallengeConsumedReason.ATTEMPTS_EXHAUSTED
          ? 'attempts_exhausted'
          : 'consumed';
      return { resent: false, reason, attemptId, userId };
    }

    if (user?.status !== UserStatus.ACTIVE) {
      await this.loginChallengeService.consume(
        challenge,
        LoginChallengeConsumedReason.USER_INACTIVE,
      );
      return { resent: false, reason: 'user_inactive', attemptId, userId };
    }

    const retryAfterSeconds =
      this.loginChallengeService.secondsUntilResend(challenge);
    if (retryAfterSeconds > 0) {
      return {
        resent: false,
        reason: 'too_soon',
        attemptId,
        userId,
        retryAfterSeconds,
      };
    }

    const { challenge: rotated, secret } =
      await this.loginChallengeService.rotateSecret(challenge);
    return { resent: true, challenge: rotated, secret, email: user.email };
  }

  /** Logs the reason and throws the response for a rejected resend. */
  private rejectLoginResend(
    outcome: Extract<LoginResendOutcome, { resent: false }>,
  ): never {
    const { reason, attemptId, userId, retryAfterSeconds } = outcome;
    this.logger.warn(
      `Login resend rejected, reason=${reason}, attemptId=${attemptId}, ` +
        `userId=${userId ?? 'unknown'}` +
        (retryAfterSeconds !== undefined
          ? `, retryAfterSeconds=${retryAfterSeconds}`
          : ''),
    );

    switch (reason) {
      case 'too_soon':
        throw new HttpException(
          apiError(
            ErrorCode.RATE_LIMIT_EXCEEDED,
            LOGIN_EMAIL_TOO_SOON_MESSAGE,
            { retryAfterSeconds: retryAfterSeconds! },
          ),
          HttpStatus.TOO_MANY_REQUESTS,
        );
      case 'attempts_exhausted':
        throw new HttpException(
          apiError(
            ErrorCode.RATE_LIMIT_EXCEEDED,
            LOGIN_ATTEMPTS_EXHAUSTED_MESSAGE,
          ),
          HttpStatus.TOO_MANY_REQUESTS,
        );
      case 'user_inactive':
        throw new UnauthorizedException(
          apiError(ErrorCode.INVALID_CREDENTIALS, INVALID_CREDENTIALS_MESSAGE),
        );
      default:
        throw new BadRequestException(
          apiError(ErrorCode.BAD_REQUEST, INVALID_LOGIN_CONFIRMATION_MESSAGE),
        );
    }
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
    // Same transaction: the user is never active without the `user` role.
    await this.defaultRoleService.assignToActivatedUser(user.id);
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
   * Registration without confirmation: creates the active user and gives it
   * the `user` role in one transaction, so a failed role insert also rolls
   * back the user.
   */
  @Transactional()
  private async registerActive(
    email: string,
    passwordHash: string,
  ): Promise<User> {
    const user = await this.usersService.createUser({
      email,
      passwordHash,
      status: UserStatus.ACTIVE,
    });
    await this.defaultRoleService.assignToActivatedUser(user.id);
    return user;
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
        `Registration email failed, method=${method}, attemptId=${attemptId}: ${code ?? 'unknown'} ${message}`,
      );
      throw new ServiceUnavailableException(
        'Confirmation email could not be sent',
      );
    }

    this.logger.log(
      `Registration email sent, method=${method}, attemptId=${attemptId}`,
    );
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

/**
 * The 202 body of a login that needs the email step. The secret is never
 * part of it.
 */
function toLoginConfirmationRequired(
  challenge: LoginChallenge,
): LoginConfirmationRequired {
  return {
    confirmationRequired: true,
    method: challenge.method,
    attemptId: challenge.id,
    expiresInSeconds: LOGIN_CHALLENGE_TTL_SECONDS,
    resendAfterSeconds: LOGIN_CHALLENGE_RESEND_AFTER_SECONDS,
  };
}
