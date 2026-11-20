import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { RbacAuthorizationService } from '../src/modules/rbac/rbac-authorization.service';
import { createTestApp, TEST_USER_HEADER } from './create-test-app';
import { createTestDatabase, dropTestDatabase } from './test-database';

/**
 * RBAC against a real PostgreSQL database: the bootstrap, the guard, the
 * policy snapshot and the admin API together. The unit tests cover the same
 * rules with mocks; this file proves what mocks can't: real transactions
 * and rollbacks, row locks, the version bump and the snapshot reload.
 *
 * The file has its own database (see `test-database.ts`). The tests run in
 * order and share the policy, so each one leaves it as it found it, or
 * builds on names nobody else uses.
 */
const DB_NAME = 'app_e2e_rbac';

describe('RBAC (e2e)', () => {
  let app: NestFastifyApplication;
  let db: DataSource;
  let adminId: string;
  /** Active before the bootstrap: gets the `user` role from it. */
  let aliceId: string;
  /** Pending before the bootstrap: gets no role. */
  let pendingId: string;

  let emailCounter = 0;
  const insertUser = async (status: string): Promise<string> => {
    emailCounter += 1;
    const rows: { id: string }[] = await db.query(
      `INSERT INTO users (email, password_hash, status)
       VALUES ($1, 'not-a-real-hash', $2) RETURNING id`,
      [`user-${emailCounter}@rbac.e2e.test`, status],
    );
    return rows[0].id;
  };

  beforeAll(async () => {
    db = await createTestDatabase(DB_NAME);
    // The users must exist before the app starts: the bootstrap runs once,
    // at startup, and skips itself without the configured admin.
    adminId = await insertUser('active');
    aliceId = await insertUser('active');
    pendingId = await insertUser('pending');

    ({ app } = await createTestApp(
      {
        POSTGRES_DB: DB_NAME,
        RBAC_BOOTSTRAP_ADMIN_USER_ID: adminId,
        REGISTRATION_EMAIL_CONFIRMATION_ENABLED: 'false',
        HEALTH_CHECK_ENABLED: 'true',
        // High enough that the IP limits never get in the way here.
        THROTTLE_GLOBAL_LIMIT: '1000',
        THROTTLE_REGISTRATION_LIMIT: '1000',
      },
      { authenticateFromHeader: true },
    ));
  });

  afterAll(async () => {
    await app?.close();
    await db?.destroy();
    await dropTestDatabase(DB_NAME);
  });

  // --- helpers --------------------------------------------------------------

  const http = () => request(app.getHttpServer());

  /** A request made by `userId` (through the test auth header). */
  const as = (userId: string) => ({
    get: (url: string) => http().get(url).set(TEST_USER_HEADER, userId),
    post: (url: string, body: object) =>
      http().post(url).set(TEST_USER_HEADER, userId).send(body),
    put: (url: string, body: object) =>
      http().put(url).set(TEST_USER_HEADER, userId).send(body),
    delete: (url: string) => http().delete(url).set(TEST_USER_HEADER, userId),
  });

  const authorize = (userId: string, permission: string, action: string) =>
    app.get(RbacAuthorizationService).authorize(userId, permission, action);

  const policyVersion = async (): Promise<number> => {
    const rows: { version: number }[] = await db.query(
      `SELECT version FROM rbac_policy_state WHERE id = 1`,
    );
    return Number(rows[0].version);
  };

  const roleNamesOf = async (userId: string): Promise<string[]> => {
    const rows: { name: string }[] = await db.query(
      `SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1 ORDER BY r.name`,
      [userId],
    );
    return rows.map((row) => row.name);
  };

  const roleId = async (name: string): Promise<string> => {
    const rows: { id: string }[] = await db.query(
      `SELECT id FROM roles WHERE name = $1`,
      [name],
    );
    return rows[0].id;
  };

  /** The `id` of a created resource; supertest types the body as `any`. */
  const idOf = (res: request.Response): string =>
    (res.body as { id: string }).id;

  /** The ids returned by the admin API (each call must succeed). */
  const createPermission = async (name: string, actions: string[]) =>
    idOf(
      await as(adminId)
        .post('/admin/rbac/permissions', { name, actions })
        .expect(201),
    );

  const createRole = async (name: string) =>
    idOf(await as(adminId).post('/admin/rbac/roles', { name }).expect(201));

  /** Without `actions` the grant covers all actions of the permission. */
  const createGrant = async (
    role: string,
    permissionId: string,
    actions?: string[],
  ) =>
    idOf(
      await as(adminId)
        .post('/admin/rbac/grants', { roleId: role, permissionId, actions })
        .expect(201),
    );

  const setRoles = (actorId: string, userId: string, roleIds: string[]) =>
    as(actorId).put(`/admin/rbac/users/${userId}/roles`, { roleIds });

  // --- tests ----------------------------------------------------------------

  describe('bootstrap', () => {
    it('creates the policy once and assigns the initial roles', async () => {
      expect(await roleNamesOf(adminId)).toEqual(['admin']);
      expect(await roleNamesOf(aliceId)).toEqual(['user']);
      expect(await roleNamesOf(pendingId)).toEqual([]);
      // One transaction, one policy change: version 0 -> 1.
      expect(await policyVersion()).toBe(1);
    });
  });

  describe('access through the guard', () => {
    it('returns 401 without an authenticated user', async () => {
      const res = await http().get('/admin/rbac/roles').expect(401);

      expect(res.body).toMatchObject({ code: 'invalid_session' });
    });

    it('returns 403 to a user without rbac@manage, naming nothing', async () => {
      const res = await as(aliceId).get('/admin/rbac/roles').expect(403);

      expect(res.body).toMatchObject({ code: 'permission_denied' });
      // The 403 must not leak the missing permission or the user's roles.
      expect(JSON.stringify(res.body)).not.toMatch(/rbac|manage|user|admin/);
    });

    it('lets the admin through', async () => {
      const res = await as(adminId).get('/admin/rbac/roles').expect(200);

      const names = (res.body as { name: string }[]).map((role) => role.name);
      expect(names).toEqual(expect.arrayContaining(['admin', 'user']));
    });

    it('denies an unknown user (no roles) by default', async () => {
      await as('00000000-0000-4000-8000-000000000000')
        .get('/admin/rbac/roles')
        .expect(403);
    });

    it('applies an admin change to the next request (snapshot reload)', async () => {
      // A role with all actions of `rbac`, given to Alice through the API.
      const rbacId = (
        (await as(adminId).get('/admin/rbac/permissions').expect(200)).body as {
          id: string;
          name: string;
        }[]
      ).find((permission) => permission.name === 'rbac')!.id;
      const rbacAll = await createRole('rbac-all');
      await createGrant(rbacAll, rbacId);
      const userRole = await roleId('user');

      await setRoles(adminId, aliceId, [userRole, rbacAll]).expect(200);
      await as(aliceId).get('/admin/rbac/roles').expect(200);

      await setRoles(adminId, aliceId, [userRole]).expect(200);
      await as(aliceId).get('/admin/rbac/roles').expect(403);
    });
  });

  describe('combined roles, all vs explicit actions', () => {
    let reportsId: string;
    let carolId: string;
    let daveId: string;

    beforeAll(async () => {
      reportsId = await createPermission('reports', [
        'read',
        'export',
        'delete',
      ]);
      const reader = await createRole('reader');
      const exporter = await createRole('exporter');
      const reportsAdmin = await createRole('reports-admin');
      await createGrant(reader, reportsId, ['read']);
      await createGrant(exporter, reportsId, ['export']);
      await createGrant(reportsAdmin, reportsId);

      carolId = await insertUser('active');
      daveId = await insertUser('active');
      await setRoles(adminId, carolId, [reader, exporter]).expect(200);
      await setRoles(adminId, daveId, [reportsAdmin]).expect(200);
    });

    it('allows the union of the actions of all the user roles', async () => {
      expect(await authorize(carolId, 'reports', 'read')).toBe(true);
      expect(await authorize(carolId, 'reports', 'export')).toBe(true);
    });

    it('denies an action no role grants', async () => {
      expect(await authorize(carolId, 'reports', 'delete')).toBe(false);
    });

    it('allows every action with an all-actions grant', async () => {
      expect(await authorize(daveId, 'reports', 'read')).toBe(true);
      expect(await authorize(daveId, 'reports', 'delete')).toBe(true);
    });

    it('denies an action the permission does not have', async () => {
      expect(await authorize(daveId, 'reports', 'archive')).toBe(false);
    });

    it('extends an all-actions grant to a new action, not explicit ones', async () => {
      await as(adminId)
        .put(`/admin/rbac/permissions/${reportsId}`, {
          name: 'reports',
          actions: ['read', 'export', 'delete', 'archive'],
        })
        .expect(200);

      expect(await authorize(daveId, 'reports', 'archive')).toBe(true);
      expect(await authorize(carolId, 'reports', 'archive')).toBe(false);
    });
  });

  describe('the rbac@manage invariant and transaction rollback', () => {
    it('rejects removing the roles of the last manager and rolls back', async () => {
      const before = await policyVersion();

      const res = await setRoles(adminId, adminId, []).expect(409);

      expect(res.body).toMatchObject({ code: 'conflict' });
      // The DELETE of the user roles ran inside the transaction, then the
      // invariant check failed: both the rows and the version are unchanged.
      expect(await roleNamesOf(adminId)).toEqual(['admin']);
      expect(await policyVersion()).toBe(before);
    });

    it('rejects deleting the grant that gives the last manager rbac@manage', async () => {
      const grants = (await as(adminId).get('/admin/rbac/grants').expect(200))
        .body as { id: string; roleId: string; actions: string[] }[];
      const adminRole = await roleId('admin');
      const rbacGrant = grants.find(
        (grant) =>
          grant.roleId === adminRole && grant.actions.includes('manage'),
      )!;
      const before = await policyVersion();

      await as(adminId)
        .delete(`/admin/rbac/grants/${rbacGrant.id}`)
        .expect(409);

      const rows: unknown[] = await db.query(
        `SELECT 1 FROM grants WHERE id = $1`,
        [rbacGrant.id],
      );
      expect(rows).toHaveLength(1);
      expect(await policyVersion()).toBe(before);
    });

    it('does not count an inactive user as a manager', async () => {
      const adminRole = await roleId('admin');
      const erinId = await insertUser('active');
      await setRoles(adminId, erinId, [adminRole]).expect(200);
      await db.query(`UPDATE users SET status = 'blocked' WHERE id = $1`, [
        erinId,
      ]);

      // Erin holds rbac@manage but is blocked, so the admin is still the last.
      await setRoles(adminId, adminId, []).expect(409);

      // Once Erin is active, the admin may give up the role...
      await db.query(`UPDATE users SET status = 'active' WHERE id = $1`, [
        erinId,
      ]);
      await setRoles(adminId, adminId, []).expect(200);
      await as(adminId).get('/admin/rbac/roles').expect(403);

      // ...and Erin can give it back. The policy is as it was before.
      await setRoles(erinId, adminId, [adminRole]).expect(200);
      await setRoles(adminId, erinId, []).expect(200);
      expect(await roleNamesOf(adminId)).toEqual(['admin']);
    });

    it('bumps the version by one on every accepted change', async () => {
      const before = await policyVersion();

      await createRole('one-more-role');

      expect(await policyVersion()).toBe(before + 1);
    });
  });

  describe('the user role on activation', () => {
    it('gives a user registered as active the user role', async () => {
      const email = 'new-user@rbac.e2e.test';
      const before = await policyVersion();

      const res = await http()
        .post('/auth/register')
        .send({ email, password: 'secret12' })
        .expect(201);

      expect(res.body).toMatchObject({ status: 'active' });
      expect(await roleNamesOf(idOf(res))).toEqual(['user']);
      // A new user role is a policy change too.
      expect(await policyVersion()).toBe(before + 1);
    });
  });

  // Last: it breaks the database on purpose (and repairs it after).
  describe('policy unavailable', () => {
    it('answers 503 and fails readiness, then recovers', async () => {
      await as(adminId).get('/admin/rbac/roles').expect(200);
      await http().get('/health').expect(200);

      // A real load error: the next reload can't read a policy table.
      await db.query(
        `ALTER TABLE grant_actions RENAME TO grant_actions_hidden`,
      );
      try {
        await db.query(
          `UPDATE rbac_policy_state SET version = version + 1 WHERE id = 1`,
        );

        const res = await as(adminId).get('/admin/rbac/roles').expect(503);
        expect(res.body).toMatchObject({ code: 'authorization_unavailable' });
        // Never turned into a 403 or a 200, even for a user without roles.
        await as(pendingId).get('/admin/rbac/roles').expect(503);
        await http().get('/health').expect(503);
      } finally {
        await db.query(
          `ALTER TABLE grant_actions_hidden RENAME TO grant_actions`,
        );
      }

      // The next check reloads the snapshot on its own.
      await as(adminId).get('/admin/rbac/roles').expect(200);
      await http().get('/health').expect(200);
    });
  });
});
