import { createTestApp } from './create-test-app';

/**
 * The app itself refuses to start with a bad secret key: the config check
 * runs when `AppModule` loads, before any route or readiness check exists.
 * The rules one by one are in `config.validation.spec.ts`; this proves the
 * real app applies them.
 *
 * `createTestApp` loads `AppModule` once per module registry, so every test
 * resets the registry and gets a fresh config.
 */
describe('Startup key validation (e2e)', () => {
  const keys = [
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'LOGIN_CHALLENGE_HMAC_KEY',
  ] as const;

  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    jest.resetModules();
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it.each(keys)('does not start when %s is empty', async (key) => {
    await expect(createTestApp({ [key]: '' })).rejects.toThrow(key);
  });

  it.each(keys)('does not start when %s is 31 bytes', async (key) => {
    await expect(createTestApp({ [key]: 'k'.repeat(31) })).rejects.toThrow(key);
  });

  it('does not start when two purposes share a key', async () => {
    const shared = 's'.repeat(32);

    await expect(
      createTestApp({
        JWT_ACCESS_SECRET: shared,
        JWT_REFRESH_SECRET: shared,
      }),
    ).rejects.toThrow(
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different keys',
    );
  });
});
