import 'dotenv/config';

import { join } from 'node:path';

import { DataSource, DataSourceOptions } from 'typeorm';

/**
 * A throwaway PostgreSQL database for one e2e file, on the server from `.env`.
 *
 * RBAC tests need a database of their own: the bootstrap only runs on an
 * empty RBAC, and the tests change the global policy (roles, grants, the
 * version). On the shared dev database that would break both the tests and
 * the data you work with.
 */

// Read once at import: `createTestApp` later overwrites `POSTGRES_DB` with
// the test database, but the drop must connect to a different one.
const MAINTENANCE_DB = process.env.POSTGRES_DB ?? 'postgres';

function connectionOptions(database: string): DataSourceOptions {
  return {
    type: 'postgres',
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    username: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database,
  };
}

/** The name goes into SQL as an identifier, so only safe characters. */
function assertSafeName(name: string): void {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe test database name: ${name}`);
  }
}

async function onMaintenanceDb(sql: string): Promise<void> {
  const maintenance = new DataSource(connectionOptions(MAINTENANCE_DB));
  await maintenance.initialize();
  try {
    await maintenance.query(sql);
  } finally {
    await maintenance.destroy();
  }
}

/**
 * Creates the database from scratch (a leftover from a crashed run is
 * dropped first) and runs all migrations. Returns a connection for seeding
 * and checking rows; the app opens its own pool with `POSTGRES_DB = name`.
 */
export async function createTestDatabase(name: string): Promise<DataSource> {
  assertSafeName(name);
  await onMaintenanceDb(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await onMaintenanceDb(`CREATE DATABASE "${name}"`);

  const db = new DataSource({
    ...connectionOptions(name),
    migrationsTableName: 'migrations',
    migrations: [join(__dirname, '../src/database/migrations/*.ts')],
  });
  await db.initialize();
  // The migrations use `uuid_generate_v4()`. The app's connection creates
  // the extension on its own (its entities have UUID columns); this one has
  // no entities, so it is created here.
  await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await db.runMigrations();
  return db;
}

/** Drops the database; `FORCE` closes connections still open to it. */
export async function dropTestDatabase(name: string): Promise<void> {
  assertSafeName(name);
  await onMaintenanceDb(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
}
