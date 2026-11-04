import type { RegistrationChallenge } from './registration-challenge.entity';

export const RegistrationChallengeMethod = {
  OTP: 'otp',
  MAGIC_LINK: 'magic_link',
} as const;

export type RegistrationChallengeMethod =
  (typeof RegistrationChallengeMethod)[keyof typeof RegistrationChallengeMethod];

export const REGISTRATION_CHALLENGE_TTL_SECONDS = 600;
export const REGISTRATION_CHALLENGE_RESEND_AFTER_SECONDS = 60;

/**
 * One message for every failed confirmation: not found, consumed, wrong
 * method and (later) wrong or expired secret. A client cannot tell from it
 * whether an attempt exists.
 */
export const INVALID_REGISTRATION_CONFIRMATION_MESSAGE =
  'Invalid or expired confirmation code or token';

export interface CreatedRegistrationChallenge {
  challenge: RegistrationChallenge;
  /**
   * The plain OTP code or magic link token. It goes only into the email
   * and is never stored or returned to the client.
   */
  secret: string;
}
