import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ConfigService } from '@/core/config/config.service';
import { RegistrationChallenge } from './registration-challenge.entity';
import {
  CreatedRegistrationChallenge,
  REGISTRATION_CHALLENGE_MAX_ATTEMPTS,
  REGISTRATION_CHALLENGE_TTL_SECONDS,
  RegistrationChallengeConsumedReason,
  RegistrationChallengeMethod,
} from './registration-challenge.types';

const OTP_MAX = 1_000_000;
const OTP_LENGTH = 6;
const MAGIC_LINK_TOKEN_BYTES = 32;

@Injectable()
export class RegistrationChallengeService {
  constructor(
    @InjectRepository(RegistrationChallenge)
    private readonly challengesRepository: Repository<RegistrationChallenge>,
    private readonly configService: ConfigService,
  ) {}

  async create(
    userId: string,
    method: RegistrationChallengeMethod,
  ): Promise<CreatedRegistrationChallenge> {
    const secret = generateSecret(method);
    const now = new Date();

    const challenge = await this.challengesRepository.save(
      this.challengesRepository.create({
        userId,
        method,
        secretHash: this.hmac(secret),
        expiresAt: new Date(
          now.getTime() + REGISTRATION_CHALLENGE_TTL_SECONDS * 1000,
        ),
        lastSentAt: now,
      }),
    );

    return { challenge, secret };
  }

  /**
   * OTP: found by id only. Comparing the code happens later, against this one
   * attempt: a 6-digit HMAC must never be searched across the whole table.
   *
   * The row is locked (`SELECT ... FOR UPDATE`) until the transaction ends:
   * a parallel confirmation of the same attempt waits here and then sees the
   * committed counter and `consumedAt`. Must be called inside a transaction.
   */
  findOtpAttemptForUpdate(
    attemptId: string,
  ): Promise<RegistrationChallenge | null> {
    return this.challengesRepository.findOne({
      where: { id: attemptId, method: RegistrationChallengeMethod.OTP },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /**
   * Magic link: found by the HMAC of the token (partial unique index). The
   * method filter stops an OTP code sent as a token from matching an OTP row.
   * Locked the same way as the OTP attempt. Must be called inside a transaction.
   */
  findMagicLinkAttemptForUpdate(
    token: string,
  ): Promise<RegistrationChallenge | null> {
    return this.challengesRepository.findOne({
      where: {
        secretHash: this.hmac(token),
        method: RegistrationChallengeMethod.MAGIC_LINK,
      },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /**
   * The newest attempt of the user, whatever its state: the resend cooldown is
   * counted from it. Locked the same way as the other lookups. Must be called
   * inside a transaction.
   */
  findLatestForUserForUpdate(
    userId: string,
  ): Promise<RegistrationChallenge | null> {
    return this.challengesRepository.findOne({
      where: { userId },
      order: { lastSentAt: 'DESC' },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /**
   * Constant-time comparison of the HMACs: `===` stops at the first different
   * character, and the response time would leak how much of the hash matched.
   */
  secretMatches(challenge: RegistrationChallenge, secret: string): boolean {
    const expected = Buffer.from(challenge.secretHash, 'hex');
    const actual = Buffer.from(this.hmac(secret), 'hex');

    // timingSafeEqual throws on different lengths; a stored hash is always 32 bytes.
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }

  /**
   * Counts a wrong entry. The fifth one also consumes the attempt, so the next
   * request is rejected even with the correct code. The row is locked by the
   * caller, so reading `attempts` and writing `attempts + 1` cannot race.
   */
  async registerWrongSecret(
    challenge: RegistrationChallenge,
  ): Promise<RegistrationChallenge> {
    const attempts = challenge.attempts + 1;
    const exhausted = attempts >= REGISTRATION_CHALLENGE_MAX_ATTEMPTS;
    const changes = {
      attempts,
      consumedAt: exhausted ? new Date() : null,
      consumedReason: exhausted
        ? RegistrationChallengeConsumedReason.ATTEMPTS_EXHAUSTED
        : null,
    };

    await this.challengesRepository.update(challenge.id, changes);
    return { ...challenge, ...changes };
  }

  async consume(
    challenge: RegistrationChallenge,
    reason: RegistrationChallengeConsumedReason,
  ): Promise<void> {
    await this.challengesRepository.update(challenge.id, {
      consumedAt: new Date(),
      consumedReason: reason,
    });
  }

  private hmac(secret: string): string {
    return createHmac(
      'sha256',
      this.configService.get('REGISTRATION_CHALLENGE_HMAC_KEY'),
    )
      .update(secret)
      .digest('hex');
  }
}

function generateSecret(method: RegistrationChallengeMethod): string {
  if (method === RegistrationChallengeMethod.OTP) {
    return randomInt(0, OTP_MAX).toString().padStart(OTP_LENGTH, '0');
  }
  return randomBytes(MAGIC_LINK_TOKEN_BYTES).toString('base64url');
}
