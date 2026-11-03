import type { RegistrationChallenge } from './registration-challenge.entity';

export const RegistrationChallengeMethod = {
  OTP: 'otp',
  MAGIC_LINK: 'magic_link',
} as const;

export type RegistrationChallengeMethod =
  (typeof RegistrationChallengeMethod)[keyof typeof RegistrationChallengeMethod];

export const REGISTRATION_CHALLENGE_TTL_SECONDS = 600;
export const REGISTRATION_CHALLENGE_RESEND_AFTER_SECONDS = 60;

export interface CreatedRegistrationChallenge {
  challenge: RegistrationChallenge;
  /**
   * The plain OTP code or magic link token. It goes only into the email
   * and is never stored or returned to the client.
   */
  secret: string;
}
