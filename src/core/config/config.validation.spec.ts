import { Config } from './config.types';
import { configValidationSchema } from './config.validation';

/**
 * Validates a config expected to be valid and returns the parsed values.
 * `validate()` types `value` as `any` when there is an error; checking the
 * error first narrows it to `Config`.
 */
const parse = (env: Record<string, string>): Config => {
  const result = configValidationSchema.validate(env);
  if (result.error) {
    throw result.error;
  }
  return result.value;
};

describe('configValidationSchema', () => {
  const validEnv = {
    PORT: '3007',
    NODE_ENV: 'test',
    COOKIE_SECRET: 'secret',
    REGISTRATION_CHALLENGE_HMAC_KEY: 'x'.repeat(32),
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'r'.repeat(32),
    LOGIN_CHALLENGE_HMAC_KEY: 'l'.repeat(32),
    AUDIT_LOG_HMAC_KEY: 'g'.repeat(32),
    JWT_ISSUER: 'test-issuer',
    JWT_AUDIENCE: 'test-audience',
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    SMTP_FROM: 'no-reply@example.com',
    POSTGRES_HOST: 'localhost',
    POSTGRES_PORT: '5432',
    POSTGRES_USER: 'postgres',
    POSTGRES_PASSWORD: 'postgres',
    POSTGRES_DB: 'app',
  };

  describe('RBAC_BOOTSTRAP_ADMIN_USER_ID', () => {
    it('is optional', () => {
      const { error } = configValidationSchema.validate(validEnv);

      expect(error).toBeUndefined();
    });

    it('accepts a UUID', () => {
      const { error } = configValidationSchema.validate({
        ...validEnv,
        RBAC_BOOTSTRAP_ADMIN_USER_ID: '3f6c1b8e-2a4d-4c5e-9f1a-7b2d3e4f5a6b',
      });

      expect(error).toBeUndefined();
    });

    it.each(['not-a-uuid', '123', ''])('rejects %p', (id) => {
      const { error } = configValidationSchema.validate({
        ...validEnv,
        RBAC_BOOTSTRAP_ADMIN_USER_ID: id,
      });

      expect(error?.message).toContain('RBAC_BOOTSTRAP_ADMIN_USER_ID');
    });
  });

  describe('secret keys', () => {
    const keys = [
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'LOGIN_CHALLENGE_HMAC_KEY',
      'REGISTRATION_CHALLENGE_HMAC_KEY',
      'AUDIT_LOG_HMAC_KEY',
    ] as const;

    it.each(keys)('%s is required', (key) => {
      const env: Record<string, string> = { ...validEnv };
      delete env[key];

      const { error } = configValidationSchema.validate(env);

      expect(error?.message).toContain(key);
    });

    it.each(keys)('%s rejects an empty value', (key) => {
      const { error } = configValidationSchema.validate({
        ...validEnv,
        [key]: '',
      });

      expect(error?.message).toContain(key);
    });

    it.each(keys)('%s rejects 31 bytes', (key) => {
      const { error } = configValidationSchema.validate({
        ...validEnv,
        [key]: 'k'.repeat(31),
      });

      expect(error?.message).toContain('at least 32 bytes');
    });

    it.each(keys)('%s rejects a key of only whitespace', (key) => {
      const { error } = configValidationSchema.validate({
        ...validEnv,
        [key]: ' '.repeat(32),
      });

      expect(error?.message).toBe(`"${key}" must not be only whitespace`);
    });

    it.each(keys)('%s counts bytes, not characters', (key) => {
      // 16 characters of 2 bytes each in UTF-8 = 32 bytes.
      const { error } = configValidationSchema.validate({
        ...validEnv,
        [key]: 'й'.repeat(16),
      });

      expect(error).toBeUndefined();
    });
  });

  describe('different secret keys', () => {
    it.each([
      ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'],
      ['JWT_ACCESS_SECRET', 'LOGIN_CHALLENGE_HMAC_KEY'],
      ['JWT_REFRESH_SECRET', 'LOGIN_CHALLENGE_HMAC_KEY'],
      ['LOGIN_CHALLENGE_HMAC_KEY', 'REGISTRATION_CHALLENGE_HMAC_KEY'],
      ['LOGIN_CHALLENGE_HMAC_KEY', 'AUDIT_LOG_HMAC_KEY'],
    ])('rejects %s equal to %s', (first, second) => {
      const shared = 's'.repeat(32);

      const { error } = configValidationSchema.validate({
        ...validEnv,
        [first]: shared,
        [second]: shared,
      });

      expect(error?.message).toBe(
        `${first} and ${second} must be different keys`,
      );
    });

    it('never puts a key value in the error message', () => {
      const shared = 'super-secret-value-'.padEnd(32, 'x');

      const { error } = configValidationSchema.validate({
        ...validEnv,
        JWT_ACCESS_SECRET: shared,
        JWT_REFRESH_SECRET: shared,
      });

      expect(error?.message).not.toContain(shared);
    });
  });

  describe('JWT_ISSUER and JWT_AUDIENCE', () => {
    it.each(['JWT_ISSUER', 'JWT_AUDIENCE'])('%s is required', (key) => {
      const env: Record<string, string> = { ...validEnv };
      delete env[key];

      const { error } = configValidationSchema.validate(env);

      expect(error?.message).toContain(key);
    });
  });

  describe('login email confirmation', () => {
    it('is off with the otp method by default', () => {
      const value = parse(validEnv);

      expect(value.LOGIN_EMAIL_CONFIRMATION_ENABLED).toBe(false);
      expect(value.LOGIN_EMAIL_CONFIRMATION_METHOD).toBe('otp');
    });

    it('rejects an unknown method', () => {
      const { error } = configValidationSchema.validate({
        ...validEnv,
        LOGIN_EMAIL_CONFIRMATION_METHOD: 'sms',
      });

      expect(error?.message).toContain('LOGIN_EMAIL_CONFIRMATION_METHOD');
    });

    it('requires LOGIN_CONFIRM_URL for magic_link', () => {
      const { error } = configValidationSchema.validate({
        ...validEnv,
        LOGIN_EMAIL_CONFIRMATION_METHOD: 'magic_link',
      });

      expect(error?.message).toContain('LOGIN_CONFIRM_URL');
    });

    it('accepts magic_link with a URL', () => {
      const { error } = configValidationSchema.validate({
        ...validEnv,
        LOGIN_EMAIL_CONFIRMATION_METHOD: 'magic_link',
        LOGIN_CONFIRM_URL: 'http://localhost:3000/login/confirm',
      });

      expect(error).toBeUndefined();
    });
  });

  describe('TRUSTED_ORIGINS', () => {
    it('is an empty list by default', () => {
      const value = parse(validEnv);

      expect(value.TRUSTED_ORIGINS).toEqual([]);
    });

    it('treats an empty value as an empty list', () => {
      const value = parse({
        ...validEnv,
        TRUSTED_ORIGINS: '',
      });

      expect(value.TRUSTED_ORIGINS).toEqual([]);
    });

    it('splits a comma-separated list and trims spaces', () => {
      const value = parse({
        ...validEnv,
        TRUSTED_ORIGINS: 'http://localhost:4200, https://app.example.com',
      });

      expect(value.TRUSTED_ORIGINS).toEqual([
        'http://localhost:4200',
        'https://app.example.com',
      ]);
    });

    it.each([
      'https://app.example.com/',
      'https://app.example.com/path',
      'ftp://app.example.com',
      'app.example.com',
      '*',
    ])('rejects %p', (origin) => {
      const { error } = configValidationSchema.validate({
        ...validEnv,
        TRUSTED_ORIGINS: origin,
      });

      expect(error?.message).toContain('invalid origin');
    });
  });
  describe('AUTH_COOKIE_SAME_SITE', () => {
    it('is strict by default', () => {
      expect(parse(validEnv).AUTH_COOKIE_SAME_SITE).toBe('strict');
    });

    it('accepts none together with a trusted origin', () => {
      const value = parse({
        ...validEnv,
        AUTH_COOKIE_SAME_SITE: 'none',
        TRUSTED_ORIGINS: 'https://app.other.com',
      });

      expect(value.AUTH_COOKIE_SAME_SITE).toBe('none');
    });

    it('rejects none without a trusted origin', () => {
      const { error } = configValidationSchema.validate({
        ...validEnv,
        AUTH_COOKIE_SAME_SITE: 'none',
      });

      expect(error?.message).toContain('TRUSTED_ORIGINS');
    });

    it.each(['lax', 'None', ''])('rejects %p', (value) => {
      const { error } = configValidationSchema.validate({
        ...validEnv,
        AUTH_COOKIE_SAME_SITE: value,
      });

      expect(error).toBeDefined();
    });
  });
});
