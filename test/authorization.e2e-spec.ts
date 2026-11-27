import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { ConfigService } from '../src/core/config/config.service';
import { TokenService } from '../src/modules/auth/token.service';
import { AuthorizationTestModule } from './authorization-test.module';
import { createTestApp } from './create-test-app';
import { createTestDatabase, dropTestDatabase } from './test-database';

/**
 * The whole 1.3 chain in the real app: access → user status → CSRF → RBAC →
 * ownership, the receipt rule and the 401/403/503 answers.
 *
 * Other files already cover parts of it and are not repeated here:
 * `access-check.e2e-spec.ts` (each non-active status, a deleted user),
 * `rbac.e2e-spec.ts` (role change on the next request, RBAC snapshot 503),
 * `csrf.e2e-spec.ts` (CSRF rules, CORS on the auth routes).
 *
 * Own database: the bootstrap gives `admin` and `user` roles, and one test
 * hides the `users` table.
 */
const DB_NAME = 'app_e2e_authorization';

describe('Authorization chain (e2e)', () => {
  const trusted = 'https://app.example.com';
  const untrusted = 'https://evil.example';
  const password = 'secret12';

  let app: NestFastifyApplication;
  let db: DataSource;
  /** Has every action of `users` (incl. `read_any`) and `rbac@manage`. */
  let adminId: string;
  /** Active before the bootstrap: the `user` role (users read/update/delete). */
  let aliceId: string;
  let bobId: string;
  /** Created after the bootstrap: no role at all. */
  let carolId: string;

  let emailCounter = 0;
  const insertUser = async (status = 'active'): Promise<string> => {
    emailCounter += 1;
    const rows: { id: string }[] = await db.query(
      `INSERT INTO users (email, password_hash, status)
       VALUES ($1, 'not-a-real-hash', $2) RETURNING id`,
      [`user-${emailCounter}@authz.e2e.test`, status],
    );
    return rows[0].id;
  };

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    adminId = await insertUser();
    aliceId = await insertUser();
    bobId = await insertUser();

    ({ app } = await createTestApp(
      {
        POSTGRES_DB: DB_NAME,
        RBAC_BOOTSTRAP_ADMIN_USER_ID: adminId,
        TRUSTED_ORIGINS: trusted,
        REGISTRATION_EMAIL_CONFIRMATION_ENABLED: 'false',
        LOGIN_EMAIL_CONFIRMATION_ENABLED: 'false',
        HEALTH_CHECK_ENABLED: 'true',
        THROTTLE_GLOBAL_LIMIT: '1000',
        THROTTLE_REGISTRATION_LIMIT: '1000',
        THROTTLE_LOGIN_LIMIT: '1000',
      },
      [AuthorizationTestModule],
    ));

    carolId = await insertUser();
  });

  afterAll(async () => {
    await app?.close();
    await db?.destroy();
    await dropTestDatabase(DB_NAME);
  });

  // --- helpers --------------------------------------------------------------

  const http = () => request(app.getHttpServer());

  const cookieOf = (userId: string) =>
    `access_token=${app.get(TokenService).signAccess(userId)}`;

  const expectStatusCode = (
    res: request.Response,
    status: number,
    code: string,
  ) => {
    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({ statusCode: status, code });
  };

  /** A token with our claims, changed by `override`, signed as given. */
  const forgeAccessToken = (
    override: Record<string, unknown> = {},
    { secret, algorithm }: { secret?: string; algorithm?: jwt.Algorithm } = {},
  ): string => {
    const config = app.get(ConfigService);
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {
      sub: aliceId,
      iss: config.get('JWT_ISSUER'),
      aud: config.get('JWT_AUDIENCE'),
      iat: now,
      exp: now + 600,
      token_use: 'access',
      ...override,
    };
    // `undefined` means "leave the claim out".
    for (const key of Object.keys(claims)) {
      if (claims[key] === undefined) delete claims[key];
    }
    return jwt.sign(claims, secret ?? config.get('JWT_ACCESS_SECRET'), {
      algorithm: algorithm ?? 'HS256',
    });
  };

  /** `alg: none`: a header, a payload and no signature. */
  const unsignedToken = (): string => {
    const part = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const config = app.get(ConfigService);
    return `${part({ alg: 'none', typ: 'JWT' })}.${part({
      sub: aliceId,
      iss: config.get('JWT_ISSUER'),
      aud: config.get('JWT_AUDIENCE'),
      iat: now,
      exp: now + 600,
      token_use: 'access',
    })}.`;
  };

  // --- 401: no identity -------------------------------------------------------

  describe('401 invalid_session for every token problem', () => {
    const cases: [string, () => string][] = [
      ['not a JWT', () => 'not-a-jwt'],
      [
        'expired',
        () =>
          forgeAccessToken({
            iat: Math.floor(Date.now() / 1000) - 3600,
            exp: Math.floor(Date.now() / 1000) - 600,
          }),
      ],
      [
        'issued in the future',
        () =>
          forgeAccessToken({
            iat: Math.floor(Date.now() / 1000) + 3600,
            exp: Math.floor(Date.now() / 1000) + 7200,
          }),
      ],
      ['wrong issuer', () => forgeAccessToken({ iss: 'someone-else' })],
      ['wrong audience', () => forgeAccessToken({ aud: 'another-app' })],
      ['no sub', () => forgeAccessToken({ sub: undefined })],
      ['no exp', () => forgeAccessToken({ exp: undefined })],
      [
        'signed with another key',
        () =>
          forgeAccessToken({}, { secret: 'another-secret-another-secret-123' }),
      ],
      [
        'another algorithm (HS512)',
        () => forgeAccessToken({}, { algorithm: 'HS512' }),
      ],
      ['alg none', () => unsignedToken()],
      [
        'a refresh token (token_use=refresh)',
        () => app.get(TokenService).signRefresh(aliceId),
      ],
    ];

    it.each(cases)('%s', async (_name, token) => {
      const res = await http()
        .get('/admin/rbac/roles')
        .set('Cookie', `access_token=${token()}`);

      expectStatusCode(res, 401, 'invalid_session');
      // The body names neither the user nor the failed check.
      expect(JSON.stringify(res.body)).not.toContain(aliceId);
    });

    it('control: the same forged claims with the right key pass to RBAC', async () => {
      const res = await http()
        .get('/admin/rbac/roles')
        .set('Cookie', `access_token=${forgeAccessToken()}`);

      // Alice lacks `rbac@manage`: a 403 proves the token itself was fine.
      expectStatusCode(res, 403, 'permission_denied');
    });
  });

  // --- 403 permission_denied --------------------------------------------------

  describe('403 permission_denied', () => {
    it('is the same for an existing and a made-up id', async () => {
      const roles: { id: string }[] = await db.query(
        `SELECT id FROM roles WHERE name = 'user'`,
      );
      const update = (id: string) =>
        http()
          .put(`/admin/rbac/roles/${id}`)
          .set('Cookie', cookieOf(aliceId))
          .send({ name: 'renamed' });

      const existing = await update(roles[0].id);
      const madeUp = await update(randomUUID());

      expectStatusCode(existing, 403, 'permission_denied');
      expect(madeUp.status).toBe(existing.status);
      expect(madeUp.body).toEqual(existing.body);
    });

    it('comes before ownership: a user with no role cannot read even itself', async () => {
      const res = await http()
        .get(`/e2e-authz/users/${carolId}`)
        .set('Cookie', cookieOf(carolId));

      expectStatusCode(res, 403, 'permission_denied');
    });
  });

  // --- ownership --------------------------------------------------------------

  describe('ownership (own data or *_any)', () => {
    const readUser = (actorId: string, targetId: string) =>
      http()
        .get(`/e2e-authz/users/${targetId}`)
        .set('Cookie', cookieOf(actorId));

    it('lets a user read itself', async () => {
      const res = await readUser(aliceId, aliceId).expect(200);

      expect(res.body).toEqual({ id: aliceId });
    });

    it('denies another user without users@read_any', async () => {
      expectStatusCode(await readUser(aliceId, bobId), 403, 'ownership_denied');
    });

    it('gives a made-up id the same 403, so existence never leaks', async () => {
      const real = await readUser(aliceId, bobId);
      const madeUp = await readUser(aliceId, randomUUID());

      expect(madeUp.status).toBe(403);
      expect(madeUp.body).toEqual(real.body);
    });

    it('lets users@read_any read another user', async () => {
      const res = await readUser(adminId, bobId).expect(200);

      expect(res.body).toEqual({ id: bobId });
    });

    it('answers 404 only after RBAC and ownership allowed it', async () => {
      expectStatusCode(await readUser(adminId, randomUUID()), 404, 'not_found');
    });
  });

  // --- receipt routes ---------------------------------------------------------

  describe('receipt routes', () => {
    const receipt = { 'Deletion-Receipt': 'r-123' };

    it('receipt only, with the header: no cookie needed', async () => {
      await http().delete('/e2e-authz/receipt').set(receipt).expect(204);
    });

    it('receipt only, with the header: a broken cookie is ignored', async () => {
      await http()
        .delete('/e2e-authz/receipt')
        .set(receipt)
        .set('Cookie', 'access_token=broken')
        .expect(204);
    });

    it('receipt only, without the header: 401 even with a valid session', async () => {
      expectStatusCode(
        await http()
          .delete('/e2e-authz/receipt')
          .set('Cookie', cookieOf(aliceId)),
        401,
        'invalid_session',
      );
    });

    it('receipt + pair, with the header: no cookie needed', async () => {
      await http()
        .delete('/e2e-authz/receipt-or-pair')
        .set(receipt)
        .expect(204);
    });

    it('receipt + pair, without the header: the usual chain', async () => {
      expectStatusCode(
        await http().delete('/e2e-authz/receipt-or-pair'),
        401,
        'invalid_session',
      );
      expectStatusCode(
        await http()
          .delete('/e2e-authz/receipt-or-pair')
          .set('Cookie', cookieOf(carolId)),
        403,
        'permission_denied',
      );
      // Alice has `users@delete` from the `user` role.
      await http()
        .delete('/e2e-authz/receipt-or-pair')
        .set('Cookie', cookieOf(aliceId))
        .expect(204);
    });
  });

  // --- public routes ----------------------------------------------------------

  describe('public routes ignore a broken access cookie', () => {
    it('GET /health', async () => {
      await http()
        .get('/health')
        .set('Cookie', 'access_token=broken')
        .expect(200);
    });

    it('POST /auth/login', async () => {
      const email = `login-${randomUUID()}@authz.e2e.test`;
      await http().post('/auth/register').send({ email, password }).expect(201);

      await http()
        .post('/auth/login')
        .set('Cookie', 'access_token=broken')
        .send({ email, password })
        .expect(204);
    });
  });

  // --- order of the checks ----------------------------------------------------

  describe('order: access → CSRF → RBAC', () => {
    const createRole = (name: string) =>
      http().post('/admin/rbac/roles').send({ name });

    it('no cookie from an untrusted origin: 401, the access check runs first', async () => {
      expectStatusCode(
        await createRole('order-a').set('Origin', untrusted),
        401,
        'invalid_session',
      );
    });

    it('a valid session from an untrusted origin: csrf_rejected, even for the admin', async () => {
      expectStatusCode(
        await createRole('order-b')
          .set('Cookie', cookieOf(adminId))
          .set('Origin', untrusted),
        403,
        'csrf_rejected',
      );
      // Nothing was created: the handler never ran.
      const rows: unknown[] = await db.query(
        `SELECT 1 FROM roles WHERE name = 'order-b'`,
      );
      expect(rows).toHaveLength(0);
    });

    it('a trusted origin without the CSRF header: csrf_rejected', async () => {
      expectStatusCode(
        await createRole('order-c')
          .set('Cookie', cookieOf(aliceId))
          .set('Origin', trusted),
        403,
        'csrf_rejected',
      );
    });

    it('a trusted origin with the header: on to RBAC', async () => {
      expectStatusCode(
        await createRole('order-d')
          .set('Cookie', cookieOf(aliceId))
          .set('Origin', trusted)
          .set('X-CSRF-Protection', '1'),
        403,
        'permission_denied',
      );
    });

    it('answers a CORS preflight to a protected route without a cookie', async () => {
      const res = await http()
        .options('/admin/rbac/roles')
        .set('Origin', trusted)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type,x-csrf-protection')
        .expect(204);

      expect(res.headers['access-control-allow-origin']).toBe(trusted);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  // --- 503 --------------------------------------------------------------------

  describe('503 authorization_unavailable', () => {
    it('when the users table cannot be read, then recovers', async () => {
      await http()
        .get('/admin/rbac/roles')
        .set('Cookie', cookieOf(aliceId))
        .expect(403);

      // A real database error, not a mock: the access check's query fails.
      await db.query(`ALTER TABLE users RENAME TO users_hidden`);
      try {
        const res = await http()
          .get('/admin/rbac/roles')
          .set('Cookie', cookieOf(aliceId));

        // Not a 401: the session may be fine, the decision just can't be made.
        expectStatusCode(res, 503, 'authorization_unavailable');
        expect(JSON.stringify(res.body)).not.toMatch(
          new RegExp(`${aliceId}|users_hidden|relation`),
        );
      } finally {
        await db.query(`ALTER TABLE users_hidden RENAME TO users`);
      }

      await http()
        .get('/admin/rbac/roles')
        .set('Cookie', cookieOf(aliceId))
        .expect(403);
    });
  });
});
