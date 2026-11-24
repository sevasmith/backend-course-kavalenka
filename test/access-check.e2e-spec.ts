import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { createTestApp } from './create-test-app';

/**
 * The access check on a protected route, with a real login cookie. A new
 * user has only the `user` role, so an admin route answers 403 once the
 * access check lets the request through: a 403 (not a 401) proves the
 * access guard ran first and RBAC got the user id.
 */
describe('Access check (e2e)', () => {
  const password = 'secret12';
  const protectedUrl = '/admin/rbac/roles';

  let app: NestFastifyApplication;
  let db: DataSource;

  beforeAll(async () => {
    ({ app } = await createTestApp({
      REGISTRATION_EMAIL_CONFIRMATION_ENABLED: 'false',
      LOGIN_EMAIL_CONFIRMATION_ENABLED: 'false',
      THROTTLE_GLOBAL_LIMIT: '1000',
      THROTTLE_REGISTRATION_LIMIT: '1000',
      THROTTLE_LOGIN_LIMIT: '1000',
    }));
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await db.query(
      `DELETE FROM users WHERE email LIKE '%@access-check.e2e.test'`,
    );
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  /** Registers an active user, logs in and returns its access cookie. */
  const loginAsNewUser = async (): Promise<{
    email: string;
    accessCookie: string;
  }> => {
    const email = `user-${randomUUID()}@access-check.e2e.test`;
    await http().post('/auth/register').send({ email, password }).expect(201);
    const res = await http()
      .post('/auth/login')
      .send({ email, password })
      .expect(204);
    const header = res.headers['set-cookie'] as unknown as string[];
    const cookie = header.find((c) => c.startsWith('access_token='));
    if (!cookie) throw new Error('no access_token cookie');
    return { email, accessCookie: cookie.split(';')[0] };
  };

  const expectInvalidSession = (res: request.Response) => {
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      statusCode: 401,
      code: 'invalid_session',
    });
  };

  it('passes an active user on to RBAC (403, not 401)', async () => {
    const { accessCookie } = await loginAsNewUser();

    const res = await http().get(protectedUrl).set('Cookie', accessCookie);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'permission_denied' });
  });

  it('answers 401 without a cookie', async () => {
    expectInvalidSession(await http().get(protectedUrl));
  });

  it('answers 401 for a tampered token', async () => {
    const { accessCookie } = await loginAsNewUser();

    expectInvalidSession(
      await http().get(protectedUrl).set('Cookie', `${accessCookie}x`),
    );
  });

  // The token is still valid: only the status read on every request stops it.
  it.each(['pending', 'blocked', 'deleting', 'deleted'])(
    'answers 401 at once when the user becomes %s',
    async (status) => {
      const { email, accessCookie } = await loginAsNewUser();
      await db.query(`UPDATE users SET status = $1 WHERE email = $2`, [
        status,
        email,
      ]);

      expectInvalidSession(
        await http().get(protectedUrl).set('Cookie', accessCookie),
      );
    },
  );

  it('answers 401 once the user row is gone', async () => {
    const { email, accessCookie } = await loginAsNewUser();
    await db.query(`DELETE FROM users WHERE email = $1`, [email]);

    expectInvalidSession(
      await http().get(protectedUrl).set('Cookie', accessCookie),
    );
  });
});
