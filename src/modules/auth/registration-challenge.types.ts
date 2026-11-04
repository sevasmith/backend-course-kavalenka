import type { RegistrationChallenge } from './registration-challenge.entity';

export const RegistrationChallengeMethod = {
  OTP: 'otp',
  MAGIC_LINK: 'magic_link',
} as const;

export type RegistrationChallengeMethod =
  (typeof RegistrationChallengeMethod)[keyof typeof RegistrationChallengeMethod];

/**
 * Why an attempt was consumed. Null while the attempt is still active.
 */
export const RegistrationChallengeConsumedReason = {
  CONFIRMED: 'confirmed',
  REPLACED: 'replaced',
  ATTEMPTS_EXHAUSTED: 'attempts_exhausted',
  USER_INACTIVE: 'user_inactive',
} as const;

export type RegistrationChallengeConsumedReason =
  (typeof RegistrationChallengeConsumedReason)[keyof typeof RegistrationChallengeConsumedReason];

export const REGISTRATION_CHALLENGE_TTL_SECONDS = 600;
/**
 * The fifth entry can still succeed; the fifth wrong one consumes the attempt.
 */
export const REGISTRATION_CHALLENGE_MAX_ATTEMPTS = 5;
export const REGISTRATION_CHALLENGE_RESEND_AFTER_SECONDS = 60;

/**
 * One message for every failed confirmation: not found, consumed, wrong
 * method, wrong or expired secret, inactive user. A client cannot tell from it
 * whether an attempt exists.
 */
export const INVALID_REGISTRATION_CONFIRMATION_MESSAGE =
  'Invalid or expired confirmation code or token';

/**
 * 429: the attempt was consumed after five wrong entries. Even the correct
 * code is rejected with it.
 */
export const REGISTRATION_ATTEMPTS_EXHAUSTED_MESSAGE =
  'Too many incorrect confirmation attempts, request a new code';

/**
 * 429: the previous email was sent less than 60 seconds ago.
 */
export const REGISTRATION_RESEND_TOO_SOON_MESSAGE =
  'Confirmation email was sent recently, try again later';

export interface CreatedRegistrationChallenge {
  challenge: RegistrationChallenge;
  /**
   * The plain OTP code or magic link token. It goes only into the email
   * and is never stored or returned to the client.
   */
  secret: string;
}
