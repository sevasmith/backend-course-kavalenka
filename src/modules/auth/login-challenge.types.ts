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
