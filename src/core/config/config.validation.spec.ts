import { configValidationSchema } from './config.validation';

describe('configValidationSchema', () => {
  const validEnv = {
    PORT: '3007',
    NODE_ENV: 'test',
    COOKIE_SECRET: 'secret',
    REGISTRATION_CHALLENGE_HMAC_KEY: 'x'.repeat(32),
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
});
