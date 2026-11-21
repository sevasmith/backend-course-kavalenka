/** How an email step delivers its secret: a 6-digit code or a link. */
export type EmailConfirmationMethod = 'otp' | 'magic_link';

export interface Config {
  PORT: number;
  NODE_ENV: 'development' | 'production' | 'test';

  /**
   * Cookie secret
   */
  COOKIE_SECRET: string;

  /**
   * Health check options
   */
  HEALTH_CHECK_ENABLED?: boolean;

  /**
   * Throttler options
   */
  THROTTLE_GLOBAL_TTL?: number;
  THROTTLE_GLOBAL_LIMIT?: number;
  THROTTLE_REGISTRATION_TTL?: number;
  THROTTLE_REGISTRATION_LIMIT?: number;
  THROTTLE_LOGIN_TTL?: number;
  THROTTLE_LOGIN_LIMIT?: number;

  /**
   * Registration options
   */
  REGISTRATION_EMAIL_CONFIRMATION_ENABLED?: boolean;
  REGISTRATION_EMAIL_CONFIRMATION_METHOD: EmailConfirmationMethod;
  REGISTRATION_CHALLENGE_HMAC_KEY: string;
  REGISTRATION_CONFIRM_URL?: string;

  /**
   * Authentication options (1.2)
   */
  /** Signs access tokens (HS256). At least 32 bytes. */
  JWT_ACCESS_SECRET: string;
  /** Signs refresh tokens (HS256). At least 32 bytes. */
  JWT_REFRESH_SECRET: string;
  /** The `iss` claim, set on issue and checked on verify. */
  JWT_ISSUER: string;
  /** The `aud` claim, set on issue and checked on verify. */
  JWT_AUDIENCE: string;
  /** Turns on the email step after a correct password at login. */
  LOGIN_EMAIL_CONFIRMATION_ENABLED: boolean;
  /** The single method the server uses for new login attempts. */
  LOGIN_EMAIL_CONFIRMATION_METHOD: EmailConfirmationMethod;
  /** HMAC-SHA256 key for login codes and link secrets. At least 32 bytes. */
  LOGIN_CHALLENGE_HMAC_KEY: string;
  /** Page the login magic link opens; the token goes after `#`. */
  LOGIN_CONFIRM_URL?: string;
  /**
   * Exact origins of trusted frontends on another origin (CORS and CSRF).
   * Empty when the frontend and the API share one origin.
   */
  TRUSTED_ORIGINS: string[];

  /**
   * RBAC options
   */
  /**
   * The user who gets the `admin` role during the one-time RBAC bootstrap.
   * Optional: while it is unset or the user doesn't exist, the bootstrap is
   * skipped and retried on the next start.
   */
  RBAC_BOOTSTRAP_ADMIN_USER_ID?: string;

  /**
   * SMTP options
   */
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_SECURE?: boolean;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM: string;

  /**
   * PostgreSQL database options
   */
  POSTGRES_HOST: string;
  POSTGRES_PORT: number;
  POSTGRES_USER: string;
  POSTGRES_PASSWORD: string;
  POSTGRES_DB: string;
  POSTGRES_SYNCHRONIZE?: boolean;
  POSTGRES_LOGGING?: boolean;
  POSTGRES_MIGRATIONS_RUN?: boolean;
}
