import Joi from 'joi';

import { Config } from './config.types';

const MIN_SECRET_BYTES = 32;

/**
 * A required secret key of at least 32 bytes (`task.md`). Joi's `.min()`
 * counts characters, and one character can take several bytes in UTF-8,
 * so the length is checked in bytes. No default: the app must never make up
 * a key, and a missing one stops it at startup.
 */
const secretKey = () =>
  Joi.string()
    .required()
    .custom((value: string, helpers) =>
      Buffer.byteLength(value, 'utf8') < MIN_SECRET_BYTES
        ? helpers.error('string.minBytes', { limit: MIN_SECRET_BYTES })
        : value,
    )
    .messages({
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
  REGISTRATION_CHALLENGE_HMAC_KEY: Joi.string().min(32).required(),
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
});
