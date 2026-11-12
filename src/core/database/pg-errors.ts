import { QueryFailedError } from 'typeorm';

/** PostgreSQL error codes: https://www.postgresql.org/docs/current/errcodes-appendix.html */
const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';

function hasPgCode(error: unknown, code: string): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string }).code === code
  );
}

/** A unique constraint rejected the write (e.g. a duplicate name). */
export function isUniqueViolation(error: unknown): boolean {
  return hasPgCode(error, PG_UNIQUE_VIOLATION);
}

/** A foreign key rejected the write (e.g. deleting a row still referenced). */
export function isForeignKeyViolation(error: unknown): boolean {
  return hasPgCode(error, PG_FOREIGN_KEY_VIOLATION);
}
