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
});
