import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { ConfigService } from '@/core/config/config.service';
import type { LoginChallenge } from './login-challenge.entity';
import {
  LOGIN_CHALLENGE_TTL_SECONDS,
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
 * Secrets of the second login step: generation, HMAC, constant-time check,
 * the magic link token format and the TTL.
 *
 * No database and no SMTP here: `AuthService` loads and locks the rows and
 * sends the email; this service only answers "which secret?" and "does it
 * match?".
 */
@Injectable()
export class LoginChallengeService {
  constructor(private readonly configService: ConfigService) {}

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
}
