/**
 * The in-memory copy of the RBAC policy, used for every access check.
 *
 * It is built in one go from the normalized tables and never changed after
 * that: a new version replaces the whole object. Everything is keyed for the
 * check in task 7 ("may user X do permission@action?").
 */
export interface RbacPolicySnapshot {
  /** `rbac_policy_state.version` the snapshot was built from. */
  readonly version: number;
  /** Permission name → its action names. */
  readonly permissionActions: ReadonlyMap<string, ReadonlySet<string>>;
  /** Role id → permission name → what the role may do with it. */
  readonly roleGrants: ReadonlyMap<string, ReadonlyMap<string, GrantSnapshot>>;
  /** User id → role ids. Users without roles are not in the map. */
  readonly userRoles: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * `allActions = true` covers every action of the permission, including ones
 * added later; `actions` is then empty. Otherwise only `actions` are allowed.
 */
export interface GrantSnapshot {
  readonly allActions: boolean;
  readonly actions: ReadonlySet<string>;
}

/** The rows the snapshot is built from, read in one consistent transaction. */
export interface RbacPolicyRows {
  version: number;
  roles: { id: string }[];
  permissions: { id: string; name: string }[];
  permissionActions: { id: string; permissionId: string; name: string }[];
  grants: {
    id: string;
    roleId: string;
    permissionId: string;
    allActions: boolean;
  }[];
  grantActions: { grantId: string; permissionActionId: string }[];
  userRoles: { userId: string; roleId: string }[];
}

/** The rows break a rule of the policy graph. The snapshot must not be used. */
export class RbacPolicyIntegrityError extends Error {
  constructor(message: string) {
    super(`Invalid RBAC policy: ${message}`);
    this.name = RbacPolicyIntegrityError.name;
  }
}

/**
 * Builds a snapshot from the rows and checks the links the DB can't enforce
 * (and, cheaply, the ones it does). Throws `RbacPolicyIntegrityError` on the
 * first broken rule: a partly valid policy never takes part in a decision.
 */
export function buildPolicySnapshot(rows: RbacPolicyRows): RbacPolicySnapshot {
  const roleIds = new Set(rows.roles.map((role) => role.id));

  const permissionNames = new Map<string, string>();
  const permissionActions = new Map<string, Set<string>>();
  for (const permission of rows.permissions) {
    permissionNames.set(permission.id, permission.name);
    permissionActions.set(permission.name, new Set());
  }

  const actionsById = new Map<string, { permissionId: string; name: string }>();
  for (const action of rows.permissionActions) {
    const permissionName = permissionNames.get(action.permissionId);
    if (permissionName === undefined) {
      throw new RbacPolicyIntegrityError(
        `action ${action.id} points to a missing permission`,
      );
    }
    permissionActions.get(permissionName)!.add(action.name);
    actionsById.set(action.id, action);
  }

  const explicitActions = new Map<string, Set<string>>();
  for (const { grantId, permissionActionId } of rows.grantActions) {
    let actions = explicitActions.get(grantId);
    if (!actions) {
      actions = new Set();
      explicitActions.set(grantId, actions);
    }
    actions.add(permissionActionId);
  }

  const roleGrants = new Map<string, Map<string, GrantSnapshot>>();
  for (const grant of rows.grants) {
    const permissionName = permissionNames.get(grant.permissionId);
    if (!roleIds.has(grant.roleId) || permissionName === undefined) {
      throw new RbacPolicyIntegrityError(
        `grant ${grant.id} points to a missing role or permission`,
      );
    }

    const actionIds = explicitActions.get(grant.id) ?? new Set<string>();
    explicitActions.delete(grant.id);

    // Both cases are written by the service; the DB can't check them.
    if (grant.allActions && actionIds.size > 0) {
      throw new RbacPolicyIntegrityError(
        `grant ${grant.id} has all actions and explicit actions`,
      );
    }
    if (!grant.allActions && actionIds.size === 0) {
      throw new RbacPolicyIntegrityError(`grant ${grant.id} has no actions`);
    }

    const actions = new Set<string>();
    for (const actionId of actionIds) {
      const action = actionsById.get(actionId);
      if (action?.permissionId !== grant.permissionId) {
        throw new RbacPolicyIntegrityError(
          `grant ${grant.id} lists an action of another permission`,
        );
      }
      actions.add(action.name);
    }

    let grants = roleGrants.get(grant.roleId);
    if (!grants) {
      grants = new Map();
      roleGrants.set(grant.roleId, grants);
    }
    grants.set(permissionName, { allActions: grant.allActions, actions });
  }

  if (explicitActions.size > 0) {
    throw new RbacPolicyIntegrityError(
      'grant actions point to a missing grant',
    );
  }

  const userRoles = new Map<string, Set<string>>();
  for (const { userId, roleId } of rows.userRoles) {
    if (!roleIds.has(roleId)) {
      throw new RbacPolicyIntegrityError(
        `user ${userId} has a missing role ${roleId}`,
      );
    }
    let roles = userRoles.get(userId);
    if (!roles) {
      roles = new Set();
      userRoles.set(userId, roles);
    }
    roles.add(roleId);
  }

  return { version: rows.version, permissionActions, roleGrants, userRoles };
}
