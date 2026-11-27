import { ForbiddenException, Injectable } from '@nestjs/common';

import { apiError, ErrorCode } from '@/core/http/api-error';
import { ForbiddenCategory } from '@/core/logging/refusal-log';
import { currentRequestId } from '@/core/logging/request-context';
import { RbacAuditLogger } from './rbac-audit.logger';
import { RbacAuthorizationService } from './rbac-authorization.service';

/** What one ownership check needs. */
export interface OwnershipCheck {
  /** The trusted id from `request.user.id`, never from the body or params. */
  actorUserId: string;
  /** The owner of the target resource (for users: the target user's id). */
  ownerId: string;
  /** The permission of the route's base pair, e.g. `users`. */
  permission: string;
  /** The extra action that allows acting on someone else's data, e.g. `read_any`. */
  anyAction: string;
  /** The operation name for the audit log, e.g. `UsersController.findOne`. */
  operation: string;
}

/**
 * The shared ownership rule for handlers (1.3 §1.3.4).
 *
 * Runs only after `RbacGuard` has allowed the route's base pair, so the
 * handler already knows the actor may use this kind of operation at all.
 * Here we only decide "own data or someone else's":
 *
 * - the actor is the owner → allowed;
 * - someone else's data → allowed only with `permission@anyAction` in the
 *   current RBAC snapshot (e.g. `users@read_any`);
 * - otherwise → 403 `ownership_denied`.
 *
 * Where the resource lookup (and its 404) goes is the handler's choice:
 * for users the owner is the id itself, so no lookup is needed first.
 *
 * Errors: `ForbiddenException` with `ownership_denied`; when the snapshot
 * can't be loaded, `RbacPolicyUnavailableError` (503
 * `authorization_unavailable`) passes through unchanged and never becomes a
 * 403. The 403 body is neutral: no owner id, no missing action.
 *
 * Audit: a denial is logged with `ownership_denied`; an admission through
 * `*_any` is a critical operation and is logged with the target id.
 * Acting on your own data is not an RBAC decision and is not logged.
 */
@Injectable()
export class RbacOwnershipService {
  constructor(
    private readonly authorizationService: RbacAuthorizationService,
    private readonly audit: RbacAuditLogger,
  ) {}

  async assertOwnerOrAny(check: OwnershipCheck): Promise<void> {
    if (check.actorUserId === check.ownerId) {
      return;
    }

    const decision = await this.authorizationService.authorize(
      check.actorUserId,
      check.permission,
      check.anyAction,
    );
    const event = {
      actorUserId: check.actorUserId,
      permission: check.permission,
      action: check.anyAction,
      operation: check.operation,
      requestId: currentRequestId(),
      policyVersion: decision.policyVersion,
    };

    if (decision.allowed) {
      // Admitted, so the target id may be logged now (1.3 §1.5).
      this.audit.accessGranted({ ...event, targetId: check.ownerId });
      return;
    }

    // No owner id here: the actor was not admitted to the resource.
    this.audit.accessDenied(event, ForbiddenCategory.OWNERSHIP_DENIED);
    throw new ForbiddenException(
      apiError(
        ErrorCode.OWNERSHIP_DENIED,
        'Not allowed to access this resource',
      ),
    );
  }
}
