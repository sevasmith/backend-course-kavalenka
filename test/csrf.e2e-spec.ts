import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { createTestApp } from './create-test-app';

/**
 * The CSRF check and CORS in the real app: state-changing requests from
 * another origin need an exact trusted `Origin` and `X-CSRF-Protection: 1`
 * (403 `csrf_rejected` otherwise), the auth POSTs included.
 */
describe('CSRF and CORS (e2e)', () => {
  const password = 'secret12';
  const trusted = 'https://app.example.com';
  const untrusted = 'https://evil.example';

  let app: NestFastifyApplication;
  let db: DataSource;

  beforeAll(async () => {
    ({ app } = await createTestApp({
      TRUSTED_ORIGINS: trusted,
      REGISTRATION_EMAIL_CONFIRMATION_ENABLED: 'false',
      LOGIN_EMAIL_CONFIRMATION_ENABLED: 'false',
      THROTTLE_GLOBAL_LIMIT: '1000',
      THROTTLE_REGISTRATION_LIMIT: '1000',
      THROTTLE_LOGIN_LIMIT: '1000',
    }));
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await db.query(`DELETE FROM users WHERE email LIKE '%@csrf.e2e.test'`);
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  const setCookies = (res: request.Response): string[] => {
    const header = res.headers['set-cookie'] as string[] | string | undefined;
    if (header === undefined) return [];
    return Array.isArray(header) ? header : [header];
  };

  const expectCsrfRejected = (res: request.Response) => {
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ statusCode: 403, code: 'csrf_rejected' });
    expect(setCookies(res)).toHaveLength(0);
  };

  /** Registers an active user (no Origin: like curl) and returns it. */
  const newUser = async (): Promise<{ email: string; password: string }> => {
    const email = `user-${randomUUID()}@csrf.e2e.test`;
    await http().post('/auth/register').send({ email, password }).expect(201);
    return { email, password };
  };

  describe('state-changing requests', () => {
    it('rejects login from an untrusted origin, with no cookies', async () => {
      const user = await newUser();

      expectCsrfRejected(
        await http()
          .post('/auth/login')
          .set('Origin', untrusted)
          .set('X-CSRF-Protection', '1')
          .send(user),
      );
    });

    it('rejects a trusted origin without the CSRF header', async () => {
      expectCsrfRejected(
        await http().post('/auth/logout').set('Origin', trusted),
      );
    });

    it('accepts a trusted origin with the CSRF header', async () => {
      const user = await newUser();

      const res = await http()
        .post('/auth/login')
        .set('Origin', trusted)
        .set('X-CSRF-Protection', '1')
        .send(user)
        .expect(204);

      expect(setCookies(res)).toHaveLength(2);
      expect(res.headers['access-control-allow-origin']).toBe(trusted);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('accepts a same-origin request without the header', async () => {
      await http()
        .post('/auth/logout')
        .set('Host', 'api.example.com')
        .set('Origin', 'https://api.example.com')
        .expect(204);
    });

    it('accepts a request without Origin (not from a browser)', async () => {
      await http().post('/auth/logout').expect(204);
    });

    it('runs before RBAC on a protected route', async () => {
      const user = await newUser();
      const login = await http().post('/auth/login').send(user).expect(204);
      const accessCookie = setCookies(login)
        .find((c) => c.startsWith('access_token='))!
        .split(';')[0];

      // Without the CSRF check, this user would get 403 permission_denied.
      const res = await http()
        .post('/admin/rbac/roles')
        .set('Cookie', accessCookie)
        .set('Origin', untrusted)
        .send({ name: 'csrf-role' });

      expectCsrfRejected(res);
    });
  });

  describe('CORS preflight', () => {
    const preflight = (origin: string) =>
      http()
        .options('/auth/login')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST')
        .set(
          'Access-Control-Request-Headers',
          'content-type,x-csrf-protection',
        );

    it('allows a trusted origin with credentials and the CSRF header', async () => {
      const res = await preflight(trusted).expect(204);

      expect(res.headers['access-control-allow-origin']).toBe(trusted);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(
        res.headers['access-control-allow-headers'].toLowerCase(),
      ).toContain('x-csrf-protection');
    });

    it('gives an untrusted origin no CORS headers', async () => {
      const res = await preflight(untrusted);

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
