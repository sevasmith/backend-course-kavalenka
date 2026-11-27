import { Injectable, Logger, SetMetadata } from '@nestjs/common';

import { ForbiddenCategory } from '@/core/logging/refusal-log';
import type { RbacUnavailableCategory } from './rbac-policy-snapshot.service';

/** What an admin endpoint changes; used as `entityType` in audit events. */
export type RbacAuditEntityType =
  | 'role'
  | 'permission'
  | 'grant'
  | 'user_roles';

/** The kinds of admin writes. */
export type RbacAuditOperation = 'create' | 'replace' | 'delete';

export const RBAC_AUDIT_TARGET_KEY = 'rbac:auditTarget';

export interface RbacAuditTarget {
  entityType: RbacAuditEntityType;
  /** The route param that holds the entity id, e.g. `roleId`. */
  idParam?: string;
}

/**
 * Tells `RbacAdminAuditInterceptor` what the controller manages, so a
 * rejected request can be logged with its entity type and id.
 */
export const AuditTarget = (
  entityType: RbacAuditEntityType,
  idParam?: string,
) =>
  SetMetadata<string, RbacAuditTarget>(RBAC_AUDIT_TARGET_KEY, {
    entityType,
    idParam,
  });

/**
 * Operations whose successful admission is logged too, not only denials
 * (1.3 §1.5 "successful admission to critical operations"). 1.3 doesn't list
 * them; the plan suggests these, to confirm with the mentor:
 * - `rbac@manage`: changes who can do what;
 * - every `*_any` action: acting on someone else's data;
 * - every `delete`: can't be undone.
 */
export function isCriticalOperation(
  permission: string,
  action: string,
): boolean {
  return (
    (permission === 'rbac' && action === 'manage') ||
    action.endsWith('_any') ||
    action === 'delete'
  );
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Only a UUID is logged as an id. Anything else came from the client
 * unchecked (e.g. the request was rejected with 400 for this very value),
 * and could fake log lines with a newline.
 */
export function safeEntityId(value: unknown): string | undefined {
  return typeof value === 'string' && UUID_PATTERN.test(value)
    ? value
    : undefined;
}

type AuditFields = Record<string, string | number | undefined>;

/**
 * One line per event: the event name, then `key=value` pairs in a fixed
 * order. Easy to grep and to parse. Fields that are `undefined` are left out.
 */
export function formatAuditEvent(event: string, fields: AuditFields): string {
  const pairs = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`);
  return [event, ...pairs].join(' ');
}

/**
 * The RBAC audit log. Every method takes ids and fixed names only, never a
 * DTO, a request or an entity: `description`, request bodies, headers,
 * cookies and the snapshot can't end up in the log by accident.
 *
 * Policy reloads and reload errors are logged by `RbacPolicySnapshotService`.
 */
@Injectable()
export class RbacAuditLogger {
  private readonly logger = new Logger('RbacAudit');

  /** A committed admin change, with the policy version it produced. */
  adminChange(event: {
    actorUserId: string;
    operation: RbacAuditOperation;
    entityType: RbacAuditEntityType;
    entityId: string;
    policyVersion: number;
  }): void {
    this.logger.log(
      formatAuditEvent('rbac.admin.change', { ...event, result: 'success' }),
    );
  }

  /**
   * An admin request that failed after the guard let it through
   * (400, 404, 409, 503, 500). Nothing was changed: the transaction was
   * rolled back, so there is no policy version.
   */
  adminRejected(event: {
    actorUserId?: string;
    operation: string;
    entityType: RbacAuditEntityType;
    entityId?: string;
    statusCode: number;
  }): void {
    const { statusCode, ...fields } = event;
    this.logger.warn(
      formatAuditEvent('rbac.admin.rejected', {
        ...fields,
        result: statusCode,
      }),
    );
  }

  /**
   * An access check said no (403). `permission_denied` from the guard's
   * base pair (admin routes too: there it is `rbac@manage`), or
   * `ownership_denied` when someone else's data needs a `*_any` action.
   */
  accessDenied(
    event: RbacDecisionEvent,
    category:
      | typeof ForbiddenCategory.PERMISSION_DENIED
      | typeof ForbiddenCategory.OWNERSHIP_DENIED,
  ): void {
    this.logger.warn(
      formatAuditEvent('rbac.access.denied', {
        ...event,
        category,
        result: 403,
      }),
    );
  }

  /**
   * An access check said yes to a critical operation (see
   * `isCriticalOperation`). Other admissions are not logged: one line per
   * ordinary request would bury the lines that matter.
   *
   * `targetId` usually comes from the URL (`/users/:id`), so only a UUID is
   * logged: anything else could fake a log line with a newline.
   */
  accessGranted(event: RbacDecisionEvent): void {
    this.logger.log(
      formatAuditEvent('rbac.access.granted', {
        ...event,
        targetId: safeEntityId(event.targetId),
        result: 'allowed',
      }),
    );
  }

  /**
   * An access check could not run because the policy is unavailable (503).
   * The cause is logged by `RbacPolicySnapshotService`; this line records
   * who was blocked from doing what.
   */
  accessUnavailable(
    event: RbacAccessCheckEvent,
    category: RbacUnavailableCategory,
  ): void {
    this.logger.warn(
      formatAuditEvent('rbac.access.unavailable', {
        ...event,
        category,
        result: 503,
      }),
    );
  }
}

/**
 * One access check: who asked for what, on which operation. Ids and fixed
 * names only: never the token, cookies, headers, body or the user's roles.
 */
export interface RbacAccessCheckEvent {
  actorUserId: string;
  permission: string;
  action: string;
  operation: string;
  requestId?: string;
}

/** A check that reached a decision, so the policy version is known. */
export interface RbacDecisionEvent extends RbacAccessCheckEvent {
  policyVersion: number;
  /**
   * The target resource. Only on an admission: 1.3 §1.5 adds it only after
   * the actor may read the resource.
   */
  targetId?: string;
}
