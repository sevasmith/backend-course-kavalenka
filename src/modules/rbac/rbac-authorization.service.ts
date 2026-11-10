import { Injectable } from '@nestjs/common';

import { RbacPolicySnapshot } from './rbac-policy-snapshot';
import { RbacPolicySnapshotService } from './rbac-policy-snapshot.service';

/**
 * The access decision on one snapshot: may the user do `permission@action`?
 *
 * Allowed if at least one of the user's roles has a grant for the permission
 * that covers the action: either all actions, or the action in its explicit
 * list. Everything else is denied (default deny): no roles, an unknown
 * permission or action, no matching grant.
 *
 * A pure function: the same snapshot always gives the same answer, so it is
 * tested without any DB or mocks.
 */
export function isAllowed(
  snapshot: RbacPolicySnapshot,
  userId: string,
  permission: string,
  action: string,
): boolean {
  // An action the catalog doesn't know is denied even for "all actions":
  // `allActions` covers the permission's actions, not any string.
  if (!snapshot.permissionActions.get(permission)?.has(action)) {
    return false;
  }

  const roleIds = snapshot.userRoles.get(userId);
  if (!roleIds) {
    return false;
  }

  // Union of the roles: one matching grant is enough.
  for (const roleId of roleIds) {
    const grant = snapshot.roleGrants.get(roleId)?.get(permission);
    if (grant && (grant.allActions || grant.actions.has(action))) {
      return true;
    }
  }

  return false;
}

@Injectable()
export class RbacAuthorizationService {
  constructor(private readonly snapshotService: RbacPolicySnapshotService) {}

  /**
   * Checks access against the current policy version.
   *
   * Throws `RbacPolicyUnavailableError` when there is no current policy. The
   * caller must not treat that as a deny: it is a 503
   * `authorization_unavailable` (task 15), not a 403.
   */
  async authorize(
    userId: string,
    permission: string,
    action: string,
  ): Promise<boolean> {
    const snapshot = await this.snapshotService.getCurrentSnapshot();
    return isAllowed(snapshot, userId, permission, action);
  }
}
