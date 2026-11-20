import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { createTestApp, FakeMailService } from './create-test-app';
import { createTestDatabase, dropTestDatabase } from './test-database';

/**
 * The `user` role in the confirmation path of registration: the account is
 * created `pending` without roles and gets `user` in the same transaction
 * that makes it `active`. The path without confirmation is in
 * `rbac.e2e-spec.ts`. A separate file because the config differs, and the
 * config is read once per file.
 */
const DB_NAME = 'app_e2e_rbac_confirmation';

describe('RBAC user role on confirmed registration (e2e)', () => {
  let app: NestFastifyApplication;
  let mail: FakeMailService;
  let db: DataSource;

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    // RBAC must be bootstrapped, or registration assigns no role at all.
    const rows: { id: string }[] = await db.query(
      `INSERT INTO users (email, password_hash, status)
       VALUES ('admin@rbac-confirm.e2e.test', 'not-a-real-hash', 'active')
       RETURNING id`,
    );

    ({ app, mail } = await createTestApp({
      POSTGRES_DB: DB_NAME,
      RBAC_BOOTSTRAP_ADMIN_USER_ID: rows[0].id,
      REGISTRATION_EMAIL_CONFIRMATION_ENABLED: 'true',
      REGISTRATION_EMAIL_CONFIRMATION_METHOD: 'otp',
      THROTTLE_GLOBAL_LIMIT: '1000',
      THROTTLE_REGISTRATION_LIMIT: '1000',
    }));
  });

  afterAll(async () => {
    await app?.close();
    await db?.destroy();
    await dropTestDatabase(DB_NAME);
  });

  const http = () => request(app.getHttpServer());

  const roleNamesOf = async (email: string): Promise<string[]> => {
    const rows: { name: string }[] = await db.query(
      `SELECT r.name FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE u.email = $1`,
      [email],
    );
    return rows.map((row) => row.name);
  };

  it('assigns no role while pending and the user role on confirmation', async () => {
    const email = 'new-user@rbac-confirm.e2e.test';

    const registered = await http()
      .post('/auth/register')
      .send({ email, password: 'secret12' })
      .expect(202);
    expect(await roleNamesOf(email)).toEqual([]);

    await http()
      .post('/auth/register/confirm')
      .send({
        attemptId: (registered.body as { attemptId: string }).attemptId,
        code: mail.lastSecret(email),
      })
      .expect(200);

    expect(await roleNamesOf(email)).toEqual(['user']);
  });
});
