import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { createTestApp, FakeMailService } from './create-test-app';

/**
 * Registration with email confirmation turned off: the account is active at
 * once. The addresses use their own domain, so the cleanup does not touch
 * other files.
 */
describe('Registration without confirmation (e2e)', () => {
  const password = 'secret12';

  let app: NestFastifyApplication;
  let mail: FakeMailService;
  let db: DataSource;

  beforeAll(async () => {
    ({ app, mail } = await createTestApp({
      REGISTRATION_EMAIL_CONFIRMATION_ENABLED: 'false',
      // High enough that the IP limits never get in the way here.
      THROTTLE_GLOBAL_LIMIT: '1000',
      THROTTLE_REGISTRATION_LIMIT: '1000',
    }));
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await db.query(`DELETE FROM users WHERE email LIKE '%@active.e2e.test'`);
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const newEmail = () => `user-${randomUUID()}@active.e2e.test`;

  const register = (email: string) =>
    http().post('/auth/register').send({ email, password });

  it('creates an active user with 201 and sends no email', async () => {
    const email = newEmail();

    const res = await register(`  ${email.toUpperCase()} `).expect(201);

    expect(res.body).toEqual({
      id: expect.any(String) as string,
      email,
      status: 'active',
    });
    const rows: { status: string }[] = await db.query(
      `SELECT status FROM users WHERE email = $1`,
      [email],
    );
    expect(rows[0].status).toBe('active');
    expect(() => mail.lastSecret(email)).toThrow();
  });

  it('returns 409 for an email that is already registered', async () => {
    const email = newEmail();
    await register(email).expect(201);

    await register(email).expect(409);
  });

  it('returns 400 to a resend for an active user', async () => {
    const email = newEmail();
    await register(email).expect(201);

    await http().post('/auth/register/resend').send({ email }).expect(400);
  });
});
