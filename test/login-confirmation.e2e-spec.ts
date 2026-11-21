import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { createTestApp, FakeMailService } from './create-test-app';

/**
 * Login with the email step (`LOGIN_EMAIL_CONFIRMATION_ENABLED=true`, OTP):
 * a correct password gives 202 and an email, never cookies. The addresses use
 * their own domain, so the cleanup does not touch other files.
 */
describe('Login with email confirmation (e2e)', () => {
  const password = 'secret12';

  let app: NestFastifyApplication;
  let mail: FakeMailService;
  let db: DataSource;

  beforeAll(async () => {
    ({ app, mail } = await createTestApp({
      REGISTRATION_EMAIL_CONFIRMATION_ENABLED: 'false',
      LOGIN_EMAIL_CONFIRMATION_ENABLED: 'true',
      LOGIN_EMAIL_CONFIRMATION_METHOD: 'otp',
      // High enough that the IP limits never get in the way here.
      THROTTLE_GLOBAL_LIMIT: '1000',
      THROTTLE_REGISTRATION_LIMIT: '1000',
      THROTTLE_LOGIN_LIMIT: '1000',
    }));
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await db.query(
      `DELETE FROM users WHERE email LIKE '%@login-confirmation.e2e.test'`,
    );
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  /** Registers an active user (registration confirmation is off). */
  const createUser = async (): Promise<string> => {
    const email = `user-${randomUUID()}@login-confirmation.e2e.test`;
    await http().post('/auth/register').send({ email, password }).expect(201);
    return email;
  };

  const login = (email: string) =>
    http().post('/auth/login').send({ email, password });

  const attemptsOf = (email: string) =>
    db.query<
      {
        id: string;
        method: string;
        secret_hash: string;
        consumed_at: Date | null;
        consumed_reason: string | null;
      }[]
    >(
      `SELECT c.id, c.method, c.secret_hash, c.consumed_at, c.consumed_reason
         FROM login_challenges c JOIN users u ON u.id = c.user_id
        WHERE u.email = $1
        ORDER BY c.created_at`,
      [email],
    );

  /** Moves `last_sent_at` back, as if the user waited that long. */
  const age = (attemptId: string, seconds: number) =>
    db.query(
      `UPDATE login_challenges
          SET last_sent_at = last_sent_at - make_interval(secs => $2)
        WHERE id = $1`,
      [attemptId, seconds],
    );

  it('answers 202 with the attempt, sets no cookies and emails the code', async () => {
    const email = await createUser();

    const res = await login(email).expect(202);

    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.body).toEqual({
      confirmationRequired: true,
      method: 'otp',
      attemptId: expect.any(String) as string,
      expiresInSeconds: 600,
      resendAfterSeconds: 60,
    });

    const code = mail.lastSecret(email);
    expect(code).toMatch(/^\d{6}$/);
    expect(JSON.stringify(res.body)).not.toContain(code);

    const attempts = await attemptsOf(email);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      id: (res.body as { attemptId: string }).attemptId,
      method: 'otp',
      consumed_at: null,
    });
    // Only the HMAC is stored.
    expect(attempts[0].secret_hash).not.toContain(code);
  });

  it('answers 429 with the remaining seconds within 60 seconds', async () => {
    const email = await createUser();
    await login(email).expect(202);

    const res = await login(email).expect(429);

    expect(res.body).toMatchObject({
      statusCode: 429,
      code: 'rate_limit_exceeded',
    });
    const { retryAfterSeconds } = res.body as { retryAfterSeconds: number };
    expect(retryAfterSeconds).toBeGreaterThan(0);
    expect(retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(await attemptsOf(email)).toHaveLength(1);
  });

  it('replaces the previous attempt after the pause', async () => {
    const email = await createUser();
    const first = await login(email).expect(202);
    const firstId = (first.body as { attemptId: string }).attemptId;
    await age(firstId, 61);

    const second = await login(email).expect(202);

    const attempts = await attemptsOf(email);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
      id: firstId,
      consumed_reason: 'replaced',
    });
    expect(attempts[0].consumed_at).not.toBeNull();
    expect(attempts[1]).toMatchObject({
      id: (second.body as { attemptId: string }).attemptId,
      consumed_at: null,
    });
  });

  it('keeps the attempt and answers 503 with its fields when SMTP fails', async () => {
    const email = await createUser();
    mail.fail();

    const res = await login(email).expect(503);

    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.body).toEqual({
      statusCode: 503,
      code: 'service_unavailable',
      message: 'Service is temporarily unavailable',
      confirmationRequired: true,
      method: 'otp',
      attemptId: expect.any(String) as string,
      retryAfterSeconds: 60,
    });
    const attempts = await attemptsOf(email);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].id).toBe((res.body as { attemptId: string }).attemptId);
  });

  it('still answers the neutral 401 for a wrong password, with no attempt', async () => {
    const email = await createUser();

    await http()
      .post('/auth/login')
      .send({ email, password: 'wrong-password' })
      .expect(401);

    expect(await attemptsOf(email)).toHaveLength(0);
  });

  describe('POST /auth/login/confirm', () => {
    const confirm = (body: object) =>
      http().post('/auth/login/confirm').send(body);

    /** Logs in and returns the attempt id and the emailed code. */
    const startLogin = async () => {
      const email = await createUser();
      const res = await login(email).expect(202);
      const { attemptId } = res.body as { attemptId: string };
      return { email, attemptId, code: mail.lastSecret(email) };
    };

    const wrongCodeFor = (code: string) =>
      code === '000000' ? '111111' : '000000';

    const setCookies = (res: request.Response): string[] => {
      const header = res.headers['set-cookie'] as string[] | string | undefined;
      if (header === undefined) return [];
      return Array.isArray(header) ? header : [header];
    };

    it('answers 204 with both cookies and consumes the attempt as confirmed', async () => {
      const { email, attemptId, code } = await startLogin();

      const res = await confirm({ attemptId, code }).expect(204);

      expect(res.text).toBe('');
      const cookies = setCookies(res);
      expect(cookies).toHaveLength(2);
      expect(cookies.some((c) => c.startsWith('access_token='))).toBe(true);
      expect(cookies.some((c) => c.startsWith('refresh_token='))).toBe(true);
      expect((await attemptsOf(email))[0].consumed_reason).toBe('confirmed');
    });

    it('answers 400 when the same code is used again', async () => {
      const { attemptId, code } = await startLogin();
      await confirm({ attemptId, code }).expect(204);

      const res = await confirm({ attemptId, code }).expect(400);

      expect(setCookies(res)).toHaveLength(0);
      expect(res.body).toMatchObject({ code: 'bad_request' });
    });

    it('accepts the correct code as the fifth entry', async () => {
      const { attemptId, code } = await startLogin();
      for (let i = 0; i < 4; i++) {
        await confirm({ attemptId, code: wrongCodeFor(code) }).expect(400);
      }

      await confirm({ attemptId, code }).expect(204);
    });

    it('answers 400 for the fifth wrong code and 429 after it, even for the correct one', async () => {
      const { email, attemptId, code } = await startLogin();
      for (let i = 0; i < 5; i++) {
        await confirm({ attemptId, code: wrongCodeFor(code) }).expect(400);
      }

      const res = await confirm({ attemptId, code }).expect(429);

      expect(res.body).toMatchObject({ code: 'rate_limit_exceeded' });
      expect(setCookies(res)).toHaveLength(0);
      expect((await attemptsOf(email))[0].consumed_reason).toBe(
        'attempts_exhausted',
      );
    });

    it('answers 400 for an expired attempt without counting the entry', async () => {
      const { attemptId, code } = await startLogin();
      await age(attemptId, 601);

      await confirm({ attemptId, code }).expect(400);

      const [{ attempts }] = await db.query<{ attempts: number }[]>(
        `SELECT attempts FROM login_challenges WHERE id = $1`,
        [attemptId],
      );
      expect(attempts).toBe(0);
    });

    it('answers 400 for the code of a replaced attempt', async () => {
      const { email, attemptId, code } = await startLogin();
      await age(attemptId, 61);
      await login(email).expect(202);

      await confirm({ attemptId, code }).expect(400);
    });

    it('answers 401 and consumes the attempt as user_inactive for a blocked user', async () => {
      const { email, attemptId, code } = await startLogin();
      await db.query(`UPDATE users SET status = 'blocked' WHERE email = $1`, [
        email,
      ]);

      const res = await confirm({ attemptId, code }).expect(401);

      expect(res.body).toMatchObject({ code: 'invalid_credentials' });
      expect(setCookies(res)).toHaveLength(0);
      expect((await attemptsOf(email))[0].consumed_reason).toBe(
        'user_inactive',
      );
    });

    it('answers 400 for an unknown attempt', async () => {
      await confirm({ attemptId: randomUUID(), code: '123456' }).expect(400);
    });

    it('answers 400 for a token sent to an OTP attempt', async () => {
      const { attemptId } = await startLogin();

      await confirm({ token: `${attemptId}.${'A'.repeat(43)}` }).expect(400);
    });

    it('answers 400 for an invalid body', async () => {
      await confirm({ attemptId: 'nope', code: '12' }).expect(400);
    });
  });
});
