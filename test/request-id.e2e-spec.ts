import { Logger } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';

import { currentRequestId } from '../src/core/logging/request-context';
import { createTestApp } from './create-test-app';

/**
 * The request id reaches code deep inside a request (here `AuthService`,
 * which never sees the request object), and each request gets its own.
 */
describe('Request id (e2e)', () => {
  let app: NestFastifyApplication;
  /** The request id seen at the moment each warning was logged. */
  let idsAtWarn: (string | undefined)[];

  beforeAll(async () => {
    ({ app } = await createTestApp({
      THROTTLE_GLOBAL_LIMIT: '1000',
      THROTTLE_LOGIN_LIMIT: '1000',
      LOGIN_EMAIL_CONFIRMATION_ENABLED: 'false',
    }));
  });

  beforeEach(() => {
    idsAtWarn = [];
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {
      idsAtWarn.push(currentRequestId());
    });
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(() => app.close());

  const failedLogin = () =>
    request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'nobody@request-id.e2e.test', password: 'secret12' })
      .expect(401);

  it('is a UUID inside the service, and differs per request', async () => {
    await failedLogin();
    await failedLogin();

    expect(idsAtWarn).toHaveLength(2);
    for (const id of idsAtWarn) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    }
    expect(idsAtWarn[0]).not.toBe(idsAtWarn[1]);
  });

  it('also reaches the guards', async () => {
    await request(app.getHttpServer()).get('/admin/rbac/roles').expect(401);

    expect(idsAtWarn).toEqual([expect.any(String)]);
  });
});
