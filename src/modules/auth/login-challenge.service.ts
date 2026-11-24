import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { IsNull, Repository } from 'typeorm';

import { ConfigService } from '@/core/config/config.service';
import { LoginChallenge } from './login-challenge.entity';
import {
  CreatedLoginChallenge,
  LOGIN_CHALLENGE_MAX_ATTEMPTS,
  LOGIN_CHALLENGE_RESEND_AFTER_SECONDS,
  LOGIN_CHALLENGE_TTL_SECONDS,
  LoginChallengeConsumedReason,
  LoginChallengeMethod,
  LoginMagicLinkToken,
} from './login-challenge.types';

const OTP_MAX = 1_000_000;
const OTP_LENGTH = 6;
const MAGIC_LINK_SECRET_BYTES = 32;
/**
 * 32 bytes in base64url without padding: ceil(32 * 4 / 3) = 43 characters.
 */
const MAGIC_LINK_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_SEPARATOR = '.';

/**
 * The attempts of the second login step: secrets (generation, HMAC,
 * constant-time check, the magic link token format), the TTL and the resend
 * pause, and simple reads and writes of `login_challenges`.
 *
 * No transactions and no SMTP here: `AuthService` opens the transaction,
 * decides the lock order and sends the email.
 */
@Injectable()
export class LoginChallengeService {
  constructor(
    @InjectRepository(LoginChallenge)
    private readonly challengesRepository: Repository<LoginChallenge>,
    private readonly configService: ConfigService,
  ) {}

  /**
   * The user's unconsumed attempt, if any (at most one, by the partial
   * unique index). Not locked: only for the 429 pre-check before the
   * transaction, which repeats the check under the lock.
   */
  findActiveForUser(userId: string): Promise<LoginChallenge | null> {
    return this.challengesRepository.findOne({
      where: { userId, consumedAt: IsNull() },
    });
  }

  /**
   * Same as `findActiveForUser`, but locks the row (`SELECT ... FOR UPDATE`)
   * until the transaction ends. Lock the user first, then call this. Must be
   * called inside a transaction.
   */
  findActiveForUserForUpdate(userId: string): Promise<LoginChallenge | null> {
    return this.challengesRepository.findOne({
      where: { userId, consumedAt: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /**
   * By `attemptId`, whatever its state. Not locked: confirm and resend use it
   * only to learn `user_id`, so they can lock the user first and then re-read
   * the attempt with `findByIdForUpdate`.
   */
  findById(attemptId: string): Promise<LoginChallenge | null> {
    return this.challengesRepository.findOne({ where: { id: attemptId } });
  }

  /**
   * By `attemptId`, locked (`SELECT ... FOR UPDATE`) until the transaction
   * ends: a parallel confirm of the same attempt waits here and then sees the
   * committed counter and `consumed_at`. Lock the user first. Must be called
   * inside a transaction.
   */
  findByIdForUpdate(attemptId: string): Promise<LoginChallenge | null> {
    return this.challengesRepository.findOne({
      where: { id: attemptId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /**
   * Counts a wrong OTP. The fifth one also consumes the attempt as
   * `attempts_exhausted`, so the next request gets 429 even with the correct
   * code. The row is locked by the caller, so reading `attempts` and writing
   * `attempts + 1` cannot race.
   */
  async registerWrongOtp(challenge: LoginChallenge): Promise<LoginChallenge> {
    const attempts = challenge.attempts + 1;
    const exhausted = attempts >= LOGIN_CHALLENGE_MAX_ATTEMPTS;
    const changes = {
      attempts,
      consumedAt: exhausted ? new Date() : null,
      consumedReason: exhausted
        ? LoginChallengeConsumedReason.ATTEMPTS_EXHAUSTED
        : null,
    };

    await this.challengesRepository.update(challenge.id, changes);
    return { ...challenge, ...changes };
  }

  /**
   * Inserts a new attempt with a fresh secret. Only the HMAC is stored; the
   * plain secret is returned once, for the email.
   */
  async create(
    userId: string,
    method: LoginChallengeMethod,
  ): Promise<CreatedLoginChallenge> {
    const secret = this.generateSecret(method);

    const challenge = await this.challengesRepository.save(
      this.challengesRepository.create({
        userId,
        method,
        secretHash: this.hashSecret(secret),
        lastSentAt: new Date(),
      }),
    );

    return { challenge, secret };
  }

  /**
   * Resend: a new secret of the same method in the same row. `secret_hash`
   * is replaced (the old code or link stops working), `last_sent_at` restarts
   * the TTL and the pause, and the OTP counter goes back to 0. The row is
   * locked by the caller.
   */
  async rotateSecret(
    challenge: LoginChallenge,
  ): Promise<CreatedLoginChallenge> {
    const secret = this.generateSecret(challenge.method);
    const changes = {
      secretHash: this.hashSecret(secret),
      lastSentAt: new Date(),
      attempts: 0,
    };

    await this.challengesRepository.update(challenge.id, changes);
    return { challenge: { ...challenge, ...changes }, secret };
  }

  async consume(
    challenge: LoginChallenge,
    reason: LoginChallengeConsumedReason,
  ): Promise<void> {
    await this.challengesRepository.update(challenge.id, {
      consumedAt: new Date(),
      consumedReason: reason,
    });
  }

  /**
   * OTP: 6 digits with leading zeros, from a CSPRNG (`randomInt`, not
   * `Math.random`). Magic link: 32 random bytes as base64url, safe in a URL.
   */
  generateSecret(method: LoginChallengeMethod): string {
    if (method === LoginChallengeMethod.OTP) {
      return randomInt(0, OTP_MAX).toString().padStart(OTP_LENGTH, '0');
    }
    return randomBytes(MAGIC_LINK_SECRET_BYTES).toString('base64url');
  }

  /**
   * The value stored in `secret_hash`. HMAC with a server key, not a plain
   * SHA-256: with only 10^6 OTP codes, a leaked table could be brute-forced
   * without the key.
   */
  hashSecret(secret: string): string {
    return createHmac(
      'sha256',
      this.configService.get('LOGIN_CHALLENGE_HMAC_KEY'),
    )
      .update(secret)
      .digest('hex');
  }

  /**
   * Constant-time comparison of the HMACs: `===` stops at the first different
   * character, and the response time would leak how much of the hash matched.
   */
  secretMatches(challenge: LoginChallenge, secret: string): boolean {
    const expected = Buffer.from(challenge.secretHash, 'hex');
    const actual = Buffer.from(this.hashSecret(secret), 'hex');

    // timingSafeEqual throws on different lengths; a stored hash is always 32 bytes.
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }

  /**
   * The token that goes into the email link (in the URL fragment).
   */
  buildMagicLinkToken(attemptId: string, secret: string): string {
    return `${attemptId}${TOKEN_SEPARATOR}${secret}`;
  }

  /**
   * Splits `attemptId.secret`. Returns null for any other shape, so the caller
   * answers 400 without touching the database. Neither part can contain a
   * dot (UUID and base64url), so the token has exactly one.
   */
  parseMagicLinkToken(token: string): LoginMagicLinkToken | null {
    const parts = token.split(TOKEN_SEPARATOR);
    if (parts.length !== 2) {
      return null;
    }

    const [attemptId, secret] = parts;
    if (!isUUID(attemptId) || !MAGIC_LINK_SECRET_PATTERN.test(secret)) {
      return null;
    }
    return { attemptId, secret };
  }

  /**
   * Computed, not stored: `login_challenges` has no `expires_at` (BCNF).
   * A resend moves `last_sent_at` and so restarts the TTL.
   */
  expiresAt(challenge: LoginChallenge): Date {
    return new Date(
      challenge.lastSentAt.getTime() + LOGIN_CHALLENGE_TTL_SECONDS * 1000,
    );
  }

  /**
   * Expired at exactly `last_sent_at + 10 min` and later.
   */
  isExpired(challenge: LoginChallenge, now: Date = new Date()): boolean {
    return now.getTime() >= this.expiresAt(challenge).getTime();
  }

  /**
   * Whole seconds until a new email is allowed (`last_sent_at + 60 s`);
   * 0 when it is allowed now. Rounded up, so a client that waits this long
   * is never too early.
   */
  secondsUntilResend(
    challenge: LoginChallenge,
    now: Date = new Date(),
  ): number {
    const allowedAt =
      challenge.lastSentAt.getTime() +
      LOGIN_CHALLENGE_RESEND_AFTER_SECONDS * 1000;
    return Math.max(0, Math.ceil((allowedAt - now.getTime()) / 1000));
  }
}
