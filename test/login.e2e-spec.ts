import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { createTestApp } from './create-test-app';

/**
 * Direct login (`LOGIN_EMAIL_CONFIRMATION_ENABLED=false`): 204 with the two
 * auth cookies, or one neutral 401 with no cookies. The addresses use their
 * own domain, so the cleanup does not touch other files.
 */
describe('Direct login (e2e)', () => {
  const password = 'secret12';

  let app: NestFastifyApplication;
  let db: DataSource;

  beforeAll(async () => {
    ({ app } = await createTestApp({
      REGISTRATION_EMAIL_CONFIRMATION_ENABLED: 'false',
      LOGIN_EMAIL_CONFIRMATION_ENABLED: 'false',
      // High enough that the IP limits never get in the way here.
      THROTTLE_GLOBAL_LIMIT: '1000',
      THROTTLE_REGISTRATION_LIMIT: '1000',
      THROTTLE_LOGIN_LIMIT: '1000',
    }));
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await db.query(`DELETE FROM users WHERE email LIKE '%@login.e2e.test'`);
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const newEmail = () => `user-${randomUUID()}@login.e2e.test`;

  /** Registers an active user (confirmation is off). */
  const createUser = async (): Promise<string> => {
    const email = newEmail();
    await http().post('/auth/register').send({ email, password }).expect(201);
    return email;
  };

  const login = (body: object) => http().post('/auth/login').send(body);

  const setCookies = (res: request.Response): string[] => {
    const header = res.headers['set-cookie'] as string[] | string | undefined;
    if (header === undefined) return [];
    return Array.isArray(header) ? header : [header];
  };

  it('answers 204 with both cookies and no body', async () => {
    const email = await createUser();

    const res = await login({ email: ` ${email.toUpperCase()} `, password });

    expect(res.status).toBe(204);
    expect(res.text).toBe('');

    const cookies = setCookies(res);
    expect(cookies).toHaveLength(2);
    const access = cookies.find((c) => c.startsWith('access_token='));
    const refresh = cookies.find((c) => c.startsWith('refresh_token='));
    expect(access).toMatch(/Max-Age=900/);
    expect(access).toMatch(/Path=\/(;|$)/);
    expect(refresh).toMatch(/Max-Age=2592000/);
    expect(refresh).toMatch(/Path=\/auth\/refresh/);
    for (const cookie of [access!, refresh!]) {
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/Secure/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(cookie).not.toMatch(/Domain=/i);
    }
  });

  it('gives an unknown email and a wrong password the same 401', async () => {
    const email = await createUser();

    const unknown = await login({ email: newEmail(), password });
    const wrong = await login({ email, password: 'wrong123' });

    for (const res of [unknown, wrong]) {
      expect(res.status).toBe(401);
      expect(setCookies(res)).toHaveLength(0);
    }
    expect(unknown.body).toEqual({
      statusCode: 401,
      code: 'invalid_credentials',
      message: 'Invalid email or password',
    });
    expect(wrong.body).toEqual(unknown.body);
  });

  it.each(['pending', 'blocked', 'deleting', 'deleted'])(
    'gives a %s user with the right password the same 401',
    async (status) => {
      const email = await createUser();
      await db.query(`UPDATE users SET status = $1 WHERE email = $2`, [
        status,
        email,
      ]);

      const res = await login({ email, password });

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: 'invalid_credentials' });
      expect(setCookies(res)).toHaveLength(0);
    },
  );

  it('returns 400 for an invalid body', async () => {
    const res = await login({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(setCookies(res)).toHaveLength(0);
  });

  describe('failed-attempt limit (5 per email + IP in 15 minutes)', () => {
    it('returns 429 on the 6th attempt, even with the right password', async () => {
      const email = await createUser();

      for (let i = 0; i < 5; i++) {
        await login({ email, password: 'wrong123' }).expect(401);
      }

      const res = await login({ email, password });
      expect(res.status).toBe(429);
      expect(res.body).toMatchObject({ code: 'rate_limit_exceeded' });
      expect(setCookies(res)).toHaveLength(0);
    });

    it('treats an unknown email the same way', async () => {
      const email = newEmail();

      for (let i = 0; i < 5; i++) {
        await login({ email, password }).expect(401);
      }

      await login({ email, password }).expect(429);
    });

    it('does not block another email from the same IP', async () => {
      const blocked = await createUser();
      const other = await createUser();
      for (let i = 0; i < 5; i++) {
        await login({ email: blocked, password: 'wrong123' }).expect(401);
      }

      await login({ email: other, password }).expect(204);
    });

    it('starts over after a successful login', async () => {
      const email = await createUser();
      for (let i = 0; i < 4; i++) {
        await login({ email, password: 'wrong123' }).expect(401);
      }
      await login({ email, password }).expect(204);

      for (let i = 0; i < 5; i++) {
        await login({ email, password: 'wrong123' }).expect(401);
      }
      await login({ email, password }).expect(429);
    });

    it('does not count a 400 as a failure', async () => {
      const email = await createUser();
      for (let i = 0; i < 6; i++) {
        await login({ email }).expect(400);
      }

      await login({ email, password }).expect(204);
    });
  });
});
