import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { createTestApp, FakeMailService } from './create-test-app';

/**
 * Login with the email step by magic link: the email holds
 * `LOGIN_CONFIRM_URL#attemptId.secret`, and the page confirms with a POST.
 */
describe('Login with a magic link (e2e)', () => {
  const password = 'secret12';

  let app: NestFastifyApplication;
  let mail: FakeMailService;
  let db: DataSource;

  beforeAll(async () => {
    ({ app, mail } = await createTestApp({
      REGISTRATION_EMAIL_CONFIRMATION_ENABLED: 'false',
      LOGIN_EMAIL_CONFIRMATION_ENABLED: 'true',
      LOGIN_EMAIL_CONFIRMATION_METHOD: 'magic_link',
      LOGIN_CONFIRM_URL: 'http://localhost:3000/login/confirm',
      THROTTLE_GLOBAL_LIMIT: '1000',
      THROTTLE_REGISTRATION_LIMIT: '1000',
      THROTTLE_LOGIN_LIMIT: '1000',
    }));
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await db.query(
      `DELETE FROM users WHERE email LIKE '%@login-magic-link.e2e.test'`,
    );
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const confirm = (body: object) =>
    http().post('/auth/login/confirm').send(body);

  /** Registers an active user, logs in and returns the emailed token. */
  const startLogin = async () => {
    const email = `user-${randomUUID()}@login-magic-link.e2e.test`;
    await http().post('/auth/register').send({ email, password }).expect(201);
    const res = await http()
      .post('/auth/login')
      .send({ email, password })
      .expect(202);
    const { attemptId, method } = res.body as {
      attemptId: string;
      method: string;
    };
    return { attemptId, method, token: mail.lastSecret(email) };
  };

  it('emails attemptId.secret and confirms with it (204 + cookies)', async () => {
    const { attemptId, method, token } = await startLogin();

    expect(method).toBe('magic_link');
    expect(token).toMatch(new RegExp(`^${attemptId}\\.[A-Za-z0-9_-]{43}$`));

    const res = await confirm({ token }).expect(204);
    expect(res.headers['set-cookie']).toHaveLength(2);
  });

  it('answers 400 for a wrong secret without counting it', async () => {
    const { attemptId, token } = await startLogin();

    for (let i = 0; i < 6; i++) {
      await confirm({ token: `${attemptId}.${'A'.repeat(43)}` }).expect(400);
    }

    const [{ attempts }] = await db.query<{ attempts: number }[]>(
      `SELECT attempts FROM login_challenges WHERE id = $1`,
      [attemptId],
    );
    expect(attempts).toBe(0);
    // Still open: wrong links never exhaust it.
    await confirm({ token }).expect(204);
  });

  it('answers 400 for a link used twice', async () => {
    const { token } = await startLogin();
    await confirm({ token }).expect(204);

    await confirm({ token }).expect(400);
  });

  it('answers 400 for a code sent to a magic link attempt', async () => {
    const { attemptId } = await startLogin();

    await confirm({ attemptId, code: '123456' }).expect(400);
  });

  it('answers 400 for a token that is not attemptId.secret', async () => {
    await confirm({ token: 'not-a-token' }).expect(400);
  });
});
