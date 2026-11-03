export const RegistrationChallengeMethod = {
  OTP: 'otp',
  MAGIC_LINK: 'magic_link',
} as const;

export type RegistrationChallengeMethod =
  (typeof RegistrationChallengeMethod)[keyof typeof RegistrationChallengeMethod];
