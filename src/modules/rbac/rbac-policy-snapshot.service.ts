import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsolationLevel, Transactional } from 'typeorm-transactional';

import { Grant } from './grant.entity';
import { GrantAction } from './grant-action.entity';
import { Permission } from './permission.entity';
import { PermissionAction } from './permission-action.entity';
import { RbacPolicyState } from './rbac-policy-state.entity';
import {
  buildPolicySnapshot,
  RbacPolicyRows,
  RbacPolicySnapshot,
} from './rbac-policy-snapshot';
import { Role } from './role.entity';
import { UserRole } from './user-role.entity';

const POLICY_STATE_ID = 1;

/**
 * There is no current policy to check against: the snapshot could not be
 * loaded, is invalid, or its version could not be read. The request must be
 * denied with 503 `authorization_unavailable` (mapped in task 15).
 */
export class RbacPolicyUnavailableError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('RBAC policy is unavailable', options);
    this.name = RbacPolicyUnavailableError.name;
  }
}

/**
 * Keeps the RBAC policy snapshot in memory and makes sure every check uses
 * the version currently in the DB.
 *
 * `getCurrentSnapshot()` reads `rbac_policy_state.version` (one small query)
 * and returns the cached snapshot if it matches. On a mismatch it builds a
 * whole new snapshot and only then replaces the reference, so a check sees
 * either the old snapshot or the new one, never a mix. On a load error the
 * snapshot is dropped: the old rules are never used for a newer version.
 */
@Injectable()
export class RbacPolicySnapshotService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RbacPolicySnapshotService.name);

  /** `null` until the first successful load, and after a failed one. */
  private snapshot: RbacPolicySnapshot | null = null;

  /**
   * The reload in progress, shared by every check that needs it: a burst of
   * requests after a policy change triggers one reload, not one each.
   */
  private reloading: Promise<RbacPolicySnapshot> | null = null;

  constructor(
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

  /**
   * The first load. A failure doesn't stop the app: the policy stays
   * unavailable (readiness fails, task 6) and the next check retries.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.reload();
    } catch {
      // Already logged in `reload`.
    }
  }

  /** `true` once a valid snapshot is loaded (used by readiness, task 6). */
  isLoaded(): boolean {
    return this.snapshot !== null;
  }

  /**
   * The snapshot for the current DB version, reloaded if it is outdated.
   * Throws `RbacPolicyUnavailableError` when there is none.
   */
  async getCurrentSnapshot(): Promise<RbacPolicySnapshot> {
    let version: number;
    try {
      version = await this.readVersion();
    } catch (error) {
      // Without the version we can't tell if the snapshot is current.
      // It is kept: once the DB is back, it is still valid if nothing changed.
      this.logger.error('RBAC policy version could not be read');
      throw new RbacPolicyUnavailableError({ cause: error });
    }

    if (this.snapshot?.version === version) {
      return this.snapshot;
    }

    const reloaded = await this.reload();
    // The joined reload may have started before `version` was committed.
    return reloaded.version >= version ? reloaded : this.reload();
  }

  /** Starts a reload, or joins the one already running. */
  private reload(): Promise<RbacPolicySnapshot> {
    this.reloading ??= this.loadAndSwap().finally(() => {
      this.reloading = null;
    });
    return this.reloading;
  }

  private async loadAndSwap(): Promise<RbacPolicySnapshot> {
    const previousVersion = this.snapshot?.version;
    try {
      const next = buildPolicySnapshot(await this.readPolicyRows());
      this.snapshot = next; // the atomic swap: one reference assignment
      this.logger.log(
        `RBAC policy loaded, version=${next.version}, ` +
          `previousVersion=${previousVersion ?? 'none'}`,
      );
      return next;
    } catch (error) {
      this.snapshot = null;
      this.logger.error(
        `RBAC policy load failed, policy unavailable, ` +
          `previousVersion=${previousVersion ?? 'none'}, ` +
          `reason=${error instanceof Error ? error.name : 'unknown'}`,
      );
      throw new RbacPolicyUnavailableError({ cause: error });
    }
  }

  private async readVersion(): Promise<number> {
    const state = await this.policyStateRepository.findOne({
      where: { id: POLICY_STATE_ID },
      select: { version: true },
    });
    if (!state) {
      throw new Error('rbac_policy_state row is missing');
    }
    return state.version;
  }

  /**
   * All tables in one REPEATABLE READ transaction: every query sees the DB
   * as it was at the first one. With the default READ COMMITTED, an admin
   * change committed between two queries could mix old and new rows, and the
   * version read here could belong to neither.
   *
   * Called inside another transaction (the admin change helper), it joins
   * that transaction instead (`Propagation.REQUIRED`) and so sees its
   * uncommitted rows: that is how the change is checked before the commit.
   */
  @Transactional({ isolationLevel: IsolationLevel.REPEATABLE_READ })
  async readPolicyRows(): Promise<RbacPolicyRows> {
    // Sequential: one transaction is one connection, and pg runs one query
    // at a time on it anyway.
    const version = await this.readVersion();
    const roles = await this.rolesRepository.find({ select: { id: true } });
    const permissions = await this.permissionsRepository.find({
      select: { id: true, name: true },
    });
    const permissionActions = await this.permissionActionsRepository.find({
      select: { id: true, permissionId: true, name: true },
    });
    const grants = await this.grantsRepository.find({
      select: { id: true, roleId: true, permissionId: true, allActions: true },
    });
    const grantActions = await this.grantActionsRepository.find();
    const userRoles = await this.userRolesRepository.find();

    return {
      version,
      roles,
      permissions,
      permissionActions,
      grants,
      grantActions,
      userRoles,
    };
  }
}
