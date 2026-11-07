import { randomBytes, randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { createTestApp, FakeMailService } from './create-test-app';

interface PendingBody {
  confirmationRequired: true;
  method: string;
  attemptId: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

/** Expects a 202 and returns its body typed (supertest gives `any`). */
const accepted = async (req: request.Test): Promise<PendingBody> =>
  (await req.expect(202)).body as PendingBody;

/**
 * Registration with magic link confirmation against the real database. The
 * addresses use their own domain, so the cleanup does not touch other files.
 */
describe('Registration with magic link (e2e)', () => {
  const password = 'secret12';

  let app: NestFastifyApplication;
  let mail: FakeMailService;
  let db: DataSource;

  beforeAll(async () => {
    ({ app, mail } = await createTestApp({
      REGISTRATION_EMAIL_CONFIRMATION_ENABLED: 'true',
      REGISTRATION_EMAIL_CONFIRMATION_METHOD: 'magic_link',
      REGISTRATION_CONFIRM_URL: 'http://localhost:3000/register/confirm',
      // High enough that the IP limits never get in the way here.
      THROTTLE_GLOBAL_LIMIT: '1000',
      THROTTLE_REGISTRATION_LIMIT: '1000',
    }));
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await db.query(`DELETE FROM users WHERE email LIKE '%@magic.e2e.test'`);
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const newEmail = () => `user-${randomUUID()}@magic.e2e.test`;

  const register = (email: string) =>
    http().post('/auth/register').send({ email, password });
  const confirm = (token: string) =>
    http().post('/auth/register/confirm').send({ token });
  const resend = (email: string) =>
    http().post('/auth/register/resend').send({ email });

  /** Pretends the last email went out more than 60 seconds ago. */
  const allowResend = (attemptId: string) =>
    db.query(
      `UPDATE registration_challenges
       SET last_sent_at = now() - interval '61 seconds'
       WHERE id = $1`,
      [attemptId],
    );

  const statusOf = async (email: string) => {
    const rows: { status: string }[] = await db.query(
      `SELECT status FROM users WHERE email = $1`,
      [email],
    );
    return rows[0].status;
  };

  it('registers a pending user and activates it with the emailed token', async () => {
    const email = newEmail();

    const registered = await accepted(register(email));
    expect(registered).toMatchObject({
      confirmationRequired: true,
      method: 'magic_link',
      expiresInSeconds: 600,
      resendAfterSeconds: 60,
    });

    const token = mail.lastSecret(email);
    expect(JSON.stringify(registered)).not.toContain(token);
    expect(await statusOf(email)).toBe('pending');

    const confirmed = await confirm(token).expect(200);
    expect(confirmed.body).toEqual({
      id: expect.any(String) as string,
      email,
      status: 'active',
    });
    expect(await statusOf(email)).toBe('active');
  });

  it('accepts a token only once', async () => {
    const email = newEmail();
    await register(email).expect(202);
    const token = mail.lastSecret(email);

    await confirm(token).expect(200);
    await confirm(token).expect(400);
  });

  it('does not activate the account when the link is opened with GET', async () => {
    const email = newEmail();
    await register(email).expect(202);
    const token = mail.lastSecret(email);

    await http().get(`/auth/register/confirm?token=${token}`).expect(404);

    expect(await statusOf(email)).toBe('pending');
    await confirm(token).expect(200);
  });

  it('returns 400 for an unknown token', async () => {
    await confirm(randomBytes(32).toString('base64url')).expect(400);
  });

  it('returns 400 for an expired token', async () => {
    const email = newEmail();
    const body = await accepted(register(email));
    await db.query(
      `UPDATE registration_challenges SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [body.attemptId],
    );

    await confirm(mail.lastSecret(email)).expect(400);
    expect(await statusOf(email)).toBe('pending');
  });

  it('replaces the link on resend: the old token stops working, the new one confirms', async () => {
    const email = newEmail();
    const first = await accepted(register(email));
    const oldToken = mail.lastSecret(email);
    await allowResend(first.attemptId);

    const second = await accepted(resend(email));
    expect(second.method).toBe('magic_link');
    const newToken = mail.lastSecret(email);
    expect(newToken).not.toBe(oldToken);

    await confirm(oldToken).expect(400);
    await confirm(newToken).expect(200);
  });
});
