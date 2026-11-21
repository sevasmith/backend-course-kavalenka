import type { LoginChallenge } from './login-challenge.entity';

/**
 * How the second login step is confirmed. The server picks it from
 * `LOGIN_EMAIL_CONFIRMATION_METHOD`; the client never chooses.
 */
export const LoginChallengeMethod = {
  OTP: 'otp',
  MAGIC_LINK: 'magic_link',
} as const;

export type LoginChallengeMethod =
  (typeof LoginChallengeMethod)[keyof typeof LoginChallengeMethod];

/**
 * Why an attempt was consumed. Null while the attempt is still active.
 */
export const LoginChallengeConsumedReason = {
  CONFIRMED: 'confirmed',
  REPLACED: 'replaced',
  ATTEMPTS_EXHAUSTED: 'attempts_exhausted',
  USER_INACTIVE: 'user_inactive',
} as const;

export type LoginChallengeConsumedReason =
  (typeof LoginChallengeConsumedReason)[keyof typeof LoginChallengeConsumedReason];

/**
 * Both methods live 10 minutes, counted from `last_sent_at`.
 */
export const LOGIN_CHALLENGE_TTL_SECONDS = 600;

/**
 * A new email (by login or resend) only 60 seconds after `last_sent_at`.
 */
export const LOGIN_CHALLENGE_RESEND_AFTER_SECONDS = 60;

/**
 * 429: an email for this login was sent less than 60 seconds ago.
 */
export const LOGIN_EMAIL_TOO_SOON_MESSAGE =
  'Confirmation email was sent recently, try again later';

export interface CreatedLoginChallenge {
  challenge: LoginChallenge;
  /**
   * The plain OTP code or magic link secret. It goes only into the email
   * and is never stored or returned to the client.
   */
  secret: string;
}

/**
 * Parts of the magic link token `attemptId.secret`. The secret is never stored.
 */
export interface LoginMagicLinkToken {
  attemptId: string;
  secret: string;
}
