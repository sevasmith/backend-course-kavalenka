import Joi from 'joi';

import { Config } from './config.types';

const MIN_SECRET_BYTES = 32;

/**
 * A required secret key of at least 32 bytes (`task.md`). Joi's `.min()`
 * counts characters, and one character can take several bytes in UTF-8,
 * so the length is checked in bytes. A key of only whitespace is rejected
 * too: it passes the length check but is no secret at all. No default: the
 * app must never make up a key, and a missing one stops it at startup.
 */
const secretKey = () =>
  Joi.string()
    .required()
    .custom((value: string, helpers) => {
      if (value.trim() === '') {
        return helpers.error('string.blank');
      }
      if (Buffer.byteLength(value, 'utf8') < MIN_SECRET_BYTES) {
        return helpers.error('string.minBytes', { limit: MIN_SECRET_BYTES });
      }
      return value;
    })
    .messages({
      'string.blank': '{{#label}} must not be only whitespace',
      'string.minBytes': '{{#label}} must be at least {{#limit}} bytes long',
    });

/**
 * A comma-separated list of exact origins, e.g.
 * `http://localhost:4200,https://app.example.com`. Converted to an array.
 * Each entry must be a bare origin (scheme, host, optional port): no path,
 * no trailing slash, because the CSRF check compares `Origin` exactly.
 */
const originList = () =>
  Joi.string()
    // Missing or empty means "no other origins". Joi applies a default
    // without running `.custom()`, so the default is already the array.
    .empty('')
    .default([])
    .custom((value: string, helpers) => {
      const origins = value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);

      for (const origin of origins) {
        if (!isExactOrigin(origin)) {
          return helpers.error('string.origin', { value: origin });
        }
      }
      return origins;
    })
    .messages({
      'string.origin': '{{#label}} contains an invalid origin: {{#value}}',
    });

function isExactOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === value
    );
  } catch {
    return false;
  }
}

/**
 * Keys that must never share a value (1.2: "a shared key for access, refresh,
 * and the email challenge is forbidden"). With one key, a token signed for
 * one purpose would verify for another, e.g. a refresh token passing the
 * access check if `token_use` were ever skipped. The registration key is
 * included so registration and login secrets stay independent too.
 */
const SECRET_KEYS = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'LOGIN_CHALLENGE_HMAC_KEY',
  'REGISTRATION_CHALLENGE_HMAC_KEY',
] as const satisfies readonly (keyof Config)[];

/** Names of the first two variables that hold the same secret, or `null`. */
function findSharedSecretKeys(
  config: Pick<Config, (typeof SECRET_KEYS)[number]>,
): [string, string] | null {
  const seen = new Map<string, string>();
  for (const key of SECRET_KEYS) {
    const other = seen.get(config[key]);
    if (other) {
      return [other, key];
    }
    seen.set(config[key], key);
  }
  return null;
}

export const configValidationSchema = Joi.object<Config>({
  PORT: Joi.number().port().required(),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').required(),

  /**
   * Cookie secret
   */
  COOKIE_SECRET: Joi.string().required(),

  /**
   * Health check options. On by default: `/health` is the readiness check,
   * and it must fail while the RBAC policy is unavailable (1.1 RBAC).
   */
  HEALTH_CHECK_ENABLED: Joi.boolean().optional().default(true),

  /**
   * Throttler options
   */
  THROTTLE_GLOBAL_TTL: Joi.number().optional().default(10000),
  THROTTLE_GLOBAL_LIMIT: Joi.number().optional().default(10),
  THROTTLE_REGISTRATION_TTL: Joi.number().optional().default(60000),
  THROTTLE_REGISTRATION_LIMIT: Joi.number().optional().default(5),
  // task.md: no more than 30 login requests per minute from one IP.
  THROTTLE_LOGIN_TTL: Joi.number().optional().default(60000),
  THROTTLE_LOGIN_LIMIT: Joi.number().optional().default(30),

  /**
   * Registration options
   */
  REGISTRATION_EMAIL_CONFIRMATION_ENABLED: Joi.boolean()
    .optional()
    .default(false),
  REGISTRATION_EMAIL_CONFIRMATION_METHOD: Joi.string()
    .valid('otp', 'magic_link')
    .optional()
    .default('otp'),
  REGISTRATION_CHALLENGE_HMAC_KEY: secretKey(),
  REGISTRATION_CONFIRM_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .when('REGISTRATION_EMAIL_CONFIRMATION_METHOD', {
      is: 'magic_link',
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),

  /**
   * Authentication options (1.2)
   */
  JWT_ACCESS_SECRET: secretKey(),
  JWT_REFRESH_SECRET: secretKey(),
  JWT_ISSUER: Joi.string().required(),
  JWT_AUDIENCE: Joi.string().required(),
  LOGIN_EMAIL_CONFIRMATION_ENABLED: Joi.boolean().optional().default(false),
  LOGIN_EMAIL_CONFIRMATION_METHOD: Joi.string()
    .valid('otp', 'magic_link')
    .optional()
    .default('otp'),
  LOGIN_CHALLENGE_HMAC_KEY: secretKey(),
  LOGIN_CONFIRM_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .when('LOGIN_EMAIL_CONFIRMATION_METHOD', {
      is: 'magic_link',
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
  TRUSTED_ORIGINS: originList(),
  AUTH_COOKIE_SAME_SITE: Joi.string()
    .valid('strict', 'none')
    .optional()
    .default('strict'),

  /**
   * RBAC options
   */
  RBAC_BOOTSTRAP_ADMIN_USER_ID: Joi.string().uuid().optional(),

  /**
   * SMTP options
   */
  SMTP_HOST: Joi.string().hostname().required(),
  SMTP_PORT: Joi.number().port().required(),
  SMTP_SECURE: Joi.boolean().optional().default(false),
  SMTP_USER: Joi.string().optional(),
  SMTP_PASSWORD: Joi.string().when('SMTP_USER', {
    is: Joi.exist(),
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  SMTP_FROM: Joi.string().required(),

  /**
   * PostgreSQL database options
   */
  POSTGRES_HOST: Joi.string().hostname().required(),
  POSTGRES_PORT: Joi.number().port().required(),
  POSTGRES_USER: Joi.string().required(),
  POSTGRES_PASSWORD: Joi.string().required(),
  POSTGRES_DB: Joi.string().required(),
  POSTGRES_SYNCHRONIZE: Joi.boolean().optional().default(false),
  POSTGRES_LOGGING: Joi.boolean().optional().default(false),
  POSTGRES_MIGRATIONS_RUN: Joi.boolean().optional().default(false),
})
  .custom((config: Config, helpers) => {
    const shared = findSharedSecretKeys(config);
    return shared
      ? helpers.error('object.sharedSecret', { keys: shared.join(' and ') })
      : config;
  })
  .custom((config: Config, helpers) =>
    // `SameSite=None` exists only for a frontend on another site. Without a
    // trusted origin it would just weaken the cookies for nothing.
    config.AUTH_COOKIE_SAME_SITE === 'none' &&
    config.TRUSTED_ORIGINS.length === 0
      ? helpers.error('object.sameSiteWithoutOrigin')
      : config,
  )
  .messages({
    // Names the variables only: the error goes to the startup log, so it
    // must never contain the key values.
    'object.sharedSecret': '{{#keys}} must be different keys',
    'object.sameSiteWithoutOrigin':
      'AUTH_COOKIE_SAME_SITE=none needs at least one TRUSTED_ORIGINS entry',
  });
