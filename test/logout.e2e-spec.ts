import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { createTestApp } from './create-test-app';

/**
 * `POST /auth/logout`: always 204, and both cookies are cleared with the
 * attributes they were set with, whatever cookies the client sends.
 */
describe('Logout (e2e)', () => {
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
    await db.query(`DELETE FROM users WHERE email LIKE '%@logout.e2e.test'`);
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  const setCookies = (res: request.Response): string[] => {
    const header = res.headers['set-cookie'] as string[] | string | undefined;
    if (header === undefined) return [];
    return Array.isArray(header) ? header : [header];
  };

  /** Registers an active user, logs in and returns its `Cookie` header. */
  const loginCookies = async (): Promise<string> => {
    const email = `user-${randomUUID()}@logout.e2e.test`;
    await http().post('/auth/register').send({ email, password }).expect(201);
    const res = await http()
      .post('/auth/login')
      .send({ email, password })
      .expect(204);
    return setCookies(res)
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
  };

  const expectClearedCookies = (res: request.Response) => {
    expect(res.status).toBe(204);
    expect(res.text).toBe('');

    const cookies = setCookies(res);
    expect(cookies).toHaveLength(2);
    const access = cookies.find((c) => c.startsWith('access_token=;'));
    const refresh = cookies.find((c) => c.startsWith('refresh_token=;'));
    expect(access).toMatch(/Path=\/(;|$)/);
    expect(refresh).toMatch(/Path=\/auth\/refresh/);
    for (const cookie of [access!, refresh!]) {
      expect(cookie).toMatch(/Max-Age=0/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/Secure/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(cookie).not.toMatch(/Domain=/i);
    }
  };

  it('clears both cookies after a login', async () => {
    const cookie = await loginCookies();

    expectClearedCookies(
      await http().post('/auth/logout').set('Cookie', cookie),
    );
  });

  it('answers 204 without any cookie', async () => {
    expectClearedCookies(await http().post('/auth/logout'));
  });

  it('answers 204 with invalid cookies', async () => {
    expectClearedCookies(
      await http()
        .post('/auth/logout')
        .set('Cookie', 'access_token=garbage; refresh_token=garbage'),
    );
  });

  it('is idempotent: a second logout gives the same answer', async () => {
    expectClearedCookies(await http().post('/auth/logout'));
    expectClearedCookies(await http().post('/auth/logout'));
  });
});
