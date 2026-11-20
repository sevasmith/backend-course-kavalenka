import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';

import { ConfigService } from '@/core/config/config.service';
import { User } from '@/modules/users/user.entity';
import { UserStatus } from '@/modules/users/user.types';
import { Grant } from './grant.entity';
import { GrantAction } from './grant-action.entity';
import { Permission } from './permission.entity';
import { PermissionAction } from './permission-action.entity';
import { RbacPolicyState } from './rbac-policy-state.entity';
import { Role } from './role.entity';
import { UserRole } from './user-role.entity';

const POLICY_STATE_ID = 1;

/** The initial permissions and their actions (`task.md`, "Bootstrap"). */
const BOOTSTRAP_PERMISSIONS: Record<string, readonly string[]> = {
  rbac: ['manage'],
  users: [
    'read',
    'read_any',
    'update',
    'update_any',
    'delete',
    'delete_any',
    'list',
  ],
  transformations: [
    'convert',
    'history',
    'history_any',
    'download',
    'download_any',
  ],
};

/** A created permission: its id and its action ids by action name. */
interface CreatedPermission {
  id: string;
  actionIds: Map<string, string>;
}

/** A grant gives either all actions of a permission or the listed ones. */
type BootstrapGrant =
  | { permission: string; allActions: true }
  | { permission: string; actions: readonly string[] };

const USER_ROLE = 'user';
const ADMIN_ROLE = 'admin';

const BOOTSTRAP_ROLES: Record<string, readonly BootstrapGrant[]> = {
  [USER_ROLE]: [{ permission: 'users', actions: ['read', 'update', 'delete'] }],
  [ADMIN_ROLE]: [
    { permission: 'rbac', actions: ['manage'] },
    { permission: 'users', allActions: true },
    { permission: 'transformations', allActions: true },
  ],
};

/**
 * What the bootstrap did. It is returned and logged after the commit, so the
 * log never reports a change that was rolled back.
 */
export type RbacBootstrapOutcome =
  | { status: 'already_initialized' }
  | { status: 'skipped'; reason: 'admin_not_configured' | 'admin_not_found' }
  | {
      status: 'initialized';
      adminUserId: string;
      usersAssigned: number;
      version: number;
    };

/**
 * Creates the initial RBAC policy once, at startup, when RBAC is empty.
 *
 * Without an admin the bootstrap is skipped, not run partly: a non-empty RBAC
 * is never bootstrapped again, so nobody could ever get `rbac@manage`.
 *
 * It runs in `onModuleInit`: Nest finishes that hook in every module before
 * any `onApplicationBootstrap`, so the first policy snapshot load sees the
 * bootstrapped policy. Hooks of one kind run in parallel within a module.
 */
@Injectable()
export class RbacBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(RbacBootstrapService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly rolesRepository: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionsRepository: Repository<Permission>,
    @InjectRepository(PermissionAction)
    private readonly permissionActionsRepository: Repository<PermissionAction>,
    @InjectRepository(Grant)
    private readonly grantsRepository: Repository<Grant>,
    @InjectRepository(GrantAction)
    private readonly grantActionsRepository: Repository<GrantAction>,
    @InjectRepository(UserRole)
    private readonly userRolesRepository: Repository<UserRole>,
    @InjectRepository(RbacPolicyState)
    private readonly policyStateRepository: Repository<RbacPolicyState>,
  ) {}

  async onModuleInit(): Promise<void> {
    const outcome = await this.bootstrapIfEmpty();

    switch (outcome.status) {
      case 'already_initialized':
        this.logger.log('RBAC bootstrap not needed, policy already exists');
        break;
      case 'skipped':
        this.logger.warn(
          `RBAC bootstrap skipped, reason=${outcome.reason}. ` +
            'Set RBAC_BOOTSTRAP_ADMIN_USER_ID to an existing user and restart.',
        );
        break;
      case 'initialized':
        this.logger.log(
          `RBAC bootstrap done, adminUserId=${outcome.adminUserId}, ` +
            `usersAssigned=${outcome.usersAssigned}, version=${outcome.version}`,
        );
        break;
    }
  }

  /**
   * One transaction: the whole policy is created, or nothing is.
   *
   * The `rbac_policy_state` row is locked first (`SELECT ... FOR UPDATE`).
   * When several instances start at once, they run this one after another:
   * the second one waits, then sees a non-empty RBAC and does nothing.
   */
  @Transactional()
  async bootstrapIfEmpty(): Promise<RbacBootstrapOutcome> {
    const policyState = await this.policyStateRepository.findOne({
      where: { id: POLICY_STATE_ID },
      lock: { mode: 'pessimistic_write' },
    });
    if (!policyState) {
      // The migration inserts this row; without it RBAC can't work at all.
      throw new Error('rbac_policy_state row is missing, run the migrations');
    }

    if (await this.isInitialized()) {
      return { status: 'already_initialized' };
    }

    const adminUserId = this.config.get('RBAC_BOOTSTRAP_ADMIN_USER_ID');
    if (!adminUserId) {
      return { status: 'skipped', reason: 'admin_not_configured' };
    }
    if (!(await this.usersRepository.existsBy({ id: adminUserId }))) {
      return { status: 'skipped', reason: 'admin_not_found' };
    }

    const permissions = await this.createPermissions();
    const roleIds = await this.createRoles(permissions);

    await this.userRolesRepository.insert({
      userId: adminUserId,
      roleId: roleIds.get(ADMIN_ROLE)!,
    });
    const usersAssigned = await this.assignUserRoleToActiveUsers(
      roleIds.get(USER_ROLE)!,
    );

    // The policy changed, so its version changes in the same transaction.
    const version = policyState.version + 1;
    await this.policyStateRepository.update(POLICY_STATE_ID, { version });

    return { status: 'initialized', adminUserId, usersAssigned, version };
  }

  /**
   * Roles and permissions are the roots of the policy: grants, actions and
   * user roles can't exist without them. So "empty" means none of either.
   */
  private async isInitialized(): Promise<boolean> {
    const [hasRoles, hasPermissions] = await Promise.all([
      this.rolesRepository.exists(),
      this.permissionsRepository.exists(),
    ]);
    return hasRoles || hasPermissions;
  }

  /** Creates the permissions and their actions, returned by permission name. */
  private async createPermissions(): Promise<Map<string, CreatedPermission>> {
    const created = new Map<string, CreatedPermission>();

    for (const [name, actionNames] of Object.entries(BOOTSTRAP_PERMISSIONS)) {
      const permission = await this.permissionsRepository.save(
        this.permissionsRepository.create({ name, description: null }),
      );
      const actions = await this.permissionActionsRepository.save(
        actionNames.map((actionName) =>
          this.permissionActionsRepository.create({
            permissionId: permission.id,
            name: actionName,
          }),
        ),
      );
      created.set(name, {
        id: permission.id,
        actionIds: new Map(actions.map((action) => [action.name, action.id])),
      });
    }

    return created;
  }

  /**
   * Creates the roles with their grants. `allActions` grants get no
   * `grant_actions` rows: the flag already covers current and future actions.
   * Returns the role ids by name.
   */
  private async createRoles(
    permissions: Map<string, CreatedPermission>,
  ): Promise<Map<string, string>> {
    const roleIds = new Map<string, string>();

    for (const [name, grants] of Object.entries(BOOTSTRAP_ROLES)) {
      const role = await this.rolesRepository.save(
        this.rolesRepository.create({ name, description: null }),
      );
      roleIds.set(name, role.id);

      for (const grantSpec of grants) {
        const permission = permissions.get(grantSpec.permission)!;
        const allActions = 'allActions' in grantSpec;

        const grant = await this.grantsRepository.save(
          this.grantsRepository.create({
            roleId: role.id,
            permissionId: permission.id,
            allActions,
          }),
        );

        if (!allActions) {
          await this.grantActionsRepository.insert(
            grantSpec.actions.map((actionName) => ({
              grantId: grant.id,
              permissionActionId: permission.actionIds.get(actionName)!,
            })),
          );
        }
      }
    }

    return roleIds;
  }

  /**
   * One `INSERT ... SELECT`, so it doesn't load every user into memory.
   * Users who already have a role (the admin) are left out. Only `active`
   * users get the role: the others get it when they are activated (task 14).
   */
  private async assignUserRoleToActiveUsers(roleId: string): Promise<number> {
    const rows: unknown[] = await this.userRolesRepository.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT u.id, $1
       FROM users u
       WHERE u.status = $2
         AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id)
       RETURNING user_id`,
      [roleId, UserStatus.ACTIVE],
    );
    return rows.length;
  }
}
