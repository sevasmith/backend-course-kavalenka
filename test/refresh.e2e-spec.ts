import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { createTestApp } from './create-test-app';

/**
 * `POST /auth/refresh`: a valid refresh cookie of an active user gives a new
 * pair (204); anything else gives one 401 `invalid_session` with no cookies.
 */
describe('Refresh (e2e)', () => {
  const password = 'secret12';

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
    await db.query(`DELETE FROM users WHERE email LIKE '%@refresh.e2e.test'`);
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  const setCookies = (res: request.Response): string[] => {
    const header = res.headers['set-cookie'] as string[] | string | undefined;
    if (header === undefined) return [];
    return Array.isArray(header) ? header : [header];
  };

  /** The `name=value` part of a `Set-Cookie` header, ready for `Cookie`. */
  const cookiePair = (res: request.Response, name: string): string => {
    const cookie = setCookies(res).find((c) => c.startsWith(`${name}=`));
    if (!cookie) throw new Error(`no ${name} cookie`);
    return cookie.split(';')[0];
  };

  /** Registers an active user, logs in and returns its refresh cookie. */
  const loginAsNewUser = async (): Promise<{
    email: string;
    refreshCookie: string;
  }> => {
    const email = `user-${randomUUID()}@refresh.e2e.test`;
    await http().post('/auth/register').send({ email, password }).expect(201);
    const res = await http()
      .post('/auth/login')
      .send({ email, password })
      .expect(204);
    return { email, refreshCookie: cookiePair(res, 'refresh_token') };
  };

  const refresh = (cookie?: string) => {
    const req = http().post('/auth/refresh');
    return cookie ? req.set('Cookie', cookie) : req;
  };

  const expectInvalidSession = (res: request.Response) => {
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      statusCode: 401,
      code: 'invalid_session',
    });
    expect(setCookies(res)).toHaveLength(0);
  };

  it('answers 204 with a new pair of cookies and no body', async () => {
    const { refreshCookie } = await loginAsNewUser();

    const res = await refresh(refreshCookie);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    const cookies = setCookies(res);
    expect(cookies).toHaveLength(2);
    expect(cookies.find((c) => c.startsWith('access_token='))).toMatch(
      /Max-Age=900/,
    );
    expect(cookies.find((c) => c.startsWith('refresh_token='))).toMatch(
      /Path=\/auth\/refresh/,
    );
  });

  it('keeps the used refresh token valid (stateless rotation)', async () => {
    const { refreshCookie } = await loginAsNewUser();

    await refresh(refreshCookie).expect(204);
    await refresh(refreshCookie).expect(204);
  });

  it('answers 401 without a cookie', async () => {
    expectInvalidSession(await refresh());
  });

  it('ignores a token sent in the body', async () => {
    const { refreshCookie } = await loginAsNewUser();
    const token = refreshCookie.slice('refresh_token='.length);

    expectInvalidSession(
      await http().post('/auth/refresh').send({ refreshToken: token }),
    );
  });

  it('answers 401 for a tampered token', async () => {
    const { refreshCookie } = await loginAsNewUser();

    expectInvalidSession(await refresh(`${refreshCookie}x`));
  });

  it('answers 401 for an access token in the refresh cookie', async () => {
    const email = `user-${randomUUID()}@refresh.e2e.test`;
    await http().post('/auth/register').send({ email, password }).expect(201);
    const login = await http()
      .post('/auth/login')
      .send({ email, password })
      .expect(204);
    const accessToken = cookiePair(login, 'access_token').slice(
      'access_token='.length,
    );

    expectInvalidSession(await refresh(`refresh_token=${accessToken}`));
  });

  it.each(['pending', 'blocked', 'deleting', 'deleted'])(
    'answers 401 once the user is %s',
    async (status) => {
      const { email, refreshCookie } = await loginAsNewUser();
      await db.query(`UPDATE users SET status = $1 WHERE email = $2`, [
        status,
        email,
      ]);

      expectInvalidSession(await refresh(refreshCookie));
    },
  );

  it('answers 401 once the user row is gone', async () => {
    const { email, refreshCookie } = await loginAsNewUser();
    await db.query(`DELETE FROM users WHERE email = $1`, [email]);

    expectInvalidSession(await refresh(refreshCookie));
  });
});
