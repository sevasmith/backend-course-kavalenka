import { randomUUID } from 'node:crypto';

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
 * Registration with OTP confirmation against the real database. Every test
 * uses its own address in the `e2e.test` domain; they are deleted at the end.
 */
describe('Registration (e2e)', () => {
  const password = 'secret12';

  let app: NestFastifyApplication;
  let mail: FakeMailService;
  let db: DataSource;

  beforeAll(async () => {
    ({ app, mail } = await createTestApp({
      REGISTRATION_EMAIL_CONFIRMATION_ENABLED: 'true',
      REGISTRATION_EMAIL_CONFIRMATION_METHOD: 'otp',
      // High enough that the IP limits never get in the way here.
      THROTTLE_GLOBAL_LIMIT: '1000',
      THROTTLE_REGISTRATION_LIMIT: '1000',
    }));
    db = app.get(DataSource);
  });

  afterAll(async () => {
    // Attempts are removed with their user (ON DELETE CASCADE).
    await db.query(`DELETE FROM users WHERE email LIKE '%@e2e.test'`);
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const newEmail = () => `user-${randomUUID()}@e2e.test`;

  const register = (email: string) =>
    http().post('/auth/register').send({ email, password });
  const confirm = (attemptId: string, code: string) =>
    http().post('/auth/register/confirm').send({ attemptId, code });
  const resend = (email: string) =>
    http().post('/auth/register/resend').send({ email });

  /** Any 6-digit code other than the real one. */
  const wrongCode = (code: string) =>
    String((Number(code) + 1) % 1_000_000).padStart(6, '0');

  /** Pretends the last email went out more than 60 seconds ago. */
  const allowResend = (attemptId: string) =>
    db.query(
      `UPDATE registration_challenges
       SET last_sent_at = now() - interval '61 seconds'
       WHERE id = $1`,
      [attemptId],
    );

  const userByEmail = async (email: string) => {
    const rows: { status: string; password_hash: string }[] = await db.query(
      `SELECT status, password_hash FROM users WHERE email = $1`,
      [email],
    );
    return rows[0];
  };

  const challenge = async (attemptId: string) => {
    const rows: { attempts: number; consumed_reason: string | null }[] =
      await db.query(
        `SELECT attempts, consumed_reason FROM registration_challenges WHERE id = $1`,
        [attemptId],
      );
    return rows[0];
  };

  describe('main flow', () => {
    it('registers a pending user and activates it with the emailed code', async () => {
      const email = newEmail();

      const registered = await accepted(register(email));
      expect(registered).toEqual({
        confirmationRequired: true,
        method: 'otp',
        attemptId: expect.any(String) as string,
        expiresInSeconds: 600,
        resendAfterSeconds: 60,
      });

      const code = mail.lastSecret(email);
      expect(JSON.stringify(registered)).not.toContain(code);

      const user = await userByEmail(email);
      expect(user.status).toBe('pending');
      expect(user.password_hash).toMatch(/^\$argon2id\$/);

      const confirmed = await confirm(registered.attemptId, code).expect(200);
      expect(confirmed.body).toEqual({
        id: expect.any(String) as string,
        email,
        status: 'active',
      });
      expect((await userByEmail(email)).status).toBe('active');
    });

    it('rejects a second confirmation with the same code', async () => {
      const email = newEmail();
      const body = await accepted(register(email));
      const code = mail.lastSecret(email);

      await confirm(body.attemptId, code).expect(200);
      await confirm(body.attemptId, code).expect(400);
    });

    it('returns 409 for an email that is already registered, even if pending', async () => {
      const email = newEmail();
      await register(email).expect(202);

      await register(`  ${email.toUpperCase()} `).expect(409);
    });

    it('returns 400 for an invalid email or a weak password', async () => {
      await register('not-an-email').expect(400);
      await http()
        .post('/auth/register')
        .send({ email: newEmail(), password: 'onlyletters' })
        .expect(400);
    });
  });

  describe('confirmation edge cases', () => {
    it('allows five wrong codes, then rejects even the correct one with 429', async () => {
      const email = newEmail();
      const body = await accepted(register(email));
      const code = mail.lastSecret(email);

      for (let i = 0; i < 5; i++) {
        await confirm(body.attemptId, wrongCode(code)).expect(400);
      }
      expect(await challenge(body.attemptId)).toEqual({
        attempts: 5,
        consumed_reason: 'attempts_exhausted',
      });

      await confirm(body.attemptId, code).expect(429);
      expect((await userByEmail(email)).status).toBe('pending');
    });

    it('accepts the correct code on the fifth entry', async () => {
      const email = newEmail();
      const body = await accepted(register(email));
      const code = mail.lastSecret(email);

      for (let i = 0; i < 4; i++) {
        await confirm(body.attemptId, wrongCode(code)).expect(400);
      }
      await confirm(body.attemptId, code).expect(200);
    });

    it('rejects an expired code without counting the entry', async () => {
      const email = newEmail();
      const body = await accepted(register(email));
      await db.query(
        `UPDATE registration_challenges SET expires_at = now() - interval '1 second' WHERE id = $1`,
        [body.attemptId],
      );

      await confirm(body.attemptId, mail.lastSecret(email)).expect(400);
      expect((await challenge(body.attemptId)).attempts).toBe(0);
    });

    it('returns 400 for an attempt that does not exist', async () => {
      await confirm(randomUUID(), '123456').expect(400);
    });
  });

  describe('resend', () => {
    it('returns 429 when asked again within 60 seconds', async () => {
      const email = newEmail();
      await register(email).expect(202);

      await resend(email).expect(429);
    });

    it('replaces the code: the old one stops working, the new one confirms', async () => {
      const email = newEmail();
      const first = await accepted(register(email));
      const oldCode = mail.lastSecret(email);
      await confirm(first.attemptId, wrongCode(oldCode)).expect(400);
      await allowResend(first.attemptId);

      const second = await accepted(resend(email));
      expect(second).toMatchObject({
        confirmationRequired: true,
        method: 'otp',
        expiresInSeconds: 600,
        resendAfterSeconds: 60,
      });
      expect(second.attemptId).not.toBe(first.attemptId);
      expect(await challenge(first.attemptId)).toMatchObject({
        consumed_reason: 'replaced',
      });
      // The counter starts again from zero on the new attempt.
      expect((await challenge(second.attemptId)).attempts).toBe(0);

      await confirm(first.attemptId, oldCode).expect(400);
      await confirm(second.attemptId, mail.lastSecret(email)).expect(200);
    });

    it('gives a new code after five wrong ones', async () => {
      const email = newEmail();
      const first = await accepted(register(email));
      const code = mail.lastSecret(email);
      for (let i = 0; i < 5; i++) {
        await confirm(first.attemptId, wrongCode(code)).expect(400);
      }
      await allowResend(first.attemptId);

      const second = await accepted(resend(email));
      await confirm(second.attemptId, mail.lastSecret(email)).expect(200);
    });

    it('returns 400 for an unknown email and for an active user', async () => {
      await resend(newEmail()).expect(400);

      const email = newEmail();
      const body = await accepted(register(email));
      await confirm(body.attemptId, mail.lastSecret(email)).expect(200);
      await allowResend(body.attemptId);

      await resend(email).expect(400);
    });
  });

  describe('email failure', () => {
    it('returns 503, keeps the pending user and lets a resend deliver the code', async () => {
      const email = newEmail();
      mail.fail();

      await register(email).expect(503);
      expect((await userByEmail(email)).status).toBe('pending');

      // The address is taken now: only a resend can deliver the email.
      await register(email).expect(409);

      const rows: { id: string }[] = await db.query(
        `SELECT c.id FROM registration_challenges c
         JOIN users u ON u.id = c.user_id WHERE u.email = $1`,
        [email],
      );
      expect(rows).toHaveLength(1);
      await allowResend(rows[0].id);

      const body = await accepted(resend(email));
      await confirm(body.attemptId, mail.lastSecret(email)).expect(200);
    });
  });
});
