import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';

import { createTestApp } from './create-test-app';

/**
 * The IP limit on register and resend. The bodies are invalid on purpose: the
 * guard runs before validation, so they count and nothing is written.
 */
describe('Registration rate limit (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp({
      THROTTLE_GLOBAL_LIMIT: '1000',
      THROTTLE_REGISTRATION_LIMIT: '2',
      THROTTLE_REGISTRATION_TTL: '60000',
    }));
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (path: string) =>
    request(app.getHttpServer()).post(path).send({});

  it('returns 429 after the configured number of register requests', async () => {
    await post('/auth/register').expect(400);
    await post('/auth/register').expect(400);
    await post('/auth/register').expect(429);
  });

  it('counts resend separately from register', async () => {
    await post('/auth/register/resend').expect(400);
    await post('/auth/register/resend').expect(400);
    await post('/auth/register/resend').expect(429);
  });

  it('does not apply to confirm', async () => {
    for (let i = 0; i < 3; i++) {
      await post('/auth/register/confirm').expect(400);
    }
  });
});
