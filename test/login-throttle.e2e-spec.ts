import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';

import { createTestApp } from './create-test-app';

/**
 * The IP limit on login (30 per minute by default, 2 here). The bodies are
 * invalid on purpose: the guard runs before validation, so they count and no
 * password is checked.
 */
describe('Login IP rate limit (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp({
      THROTTLE_GLOBAL_LIMIT: '1000',
      THROTTLE_REGISTRATION_LIMIT: '1000',
      THROTTLE_LOGIN_LIMIT: '2',
      THROTTLE_LOGIN_TTL: '60000',
    }));
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (path: string) =>
    request(app.getHttpServer()).post(path).send({});

  it('returns 429 after the configured number of login requests', async () => {
    await post('/auth/login').expect(400);
    await post('/auth/login').expect(400);

    const res = await post('/auth/login').expect(429);
    // Our shape and text, not the library's "ThrottlerException: ...".
    expect(res.body).toEqual({
      statusCode: 429,
      code: 'rate_limit_exceeded',
      message: 'Too many requests, try again later',
      retryAfterSeconds: expect.any(Number) as number,
    });
    expect(
      (res.body as { retryAfterSeconds: number }).retryAfterSeconds,
    ).toBeGreaterThanOrEqual(1);
  });

  it('does not apply to register', async () => {
    for (let i = 0; i < 3; i++) {
      await post('/auth/register').expect(400);
    }
  });
});
