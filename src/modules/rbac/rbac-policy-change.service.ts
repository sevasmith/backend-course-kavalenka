import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';

import { User } from '@/modules/users/user.entity';
import { UserStatus } from '@/modules/users/user.types';
import { isAllowed } from './rbac-authorization.service';
import {
  buildPolicySnapshot,
  RbacPolicySnapshot,
} from './rbac-policy-snapshot';
import { RbacPolicySnapshotService } from './rbac-policy-snapshot.service';
import { RbacPolicyState } from './rbac-policy-state.entity';

const POLICY_STATE_ID = 1;

/** The right to manage RBAC. At least one user must always keep it. */
export const RBAC_MANAGE = { permission: 'rbac', action: 'manage' } as const;

/**
 * The change would leave no active user with `rbac@manage`. The whole
 * transaction is rolled back; the API answers 409 `conflict` (task 15).
 */
export class RbacManageInvariantError extends Error {
  constructor() {
    super('The change would leave no active user with rbac@manage');
    this.name = RbacManageInvariantError.name;
  }
}

export interface RbacPolicyChangeResult<T> {
  /** What the change callback returned (e.g. the created role). */
  result: T;
  /** The new `rbac_policy_state.version`, for responses and audit logs. */
  version: number;
}

/**
 * The users who may do `rbac@manage` in this snapshot, whatever their
 * account status (the snapshot doesn't know it).
 */
export function findRbacManagerIds(snapshot: RbacPolicySnapshot): string[] {
  return [...snapshot.userRoles.keys()].filter((userId) =>
    isAllowed(snapshot, userId, RBAC_MANAGE.permission, RBAC_MANAGE.action),
  );
}

/**
 * The single way to change the RBAC policy (roles, permissions, grants,
 * user roles). Every admin endpoint passes its writes to `apply`.
 */
@Injectable()
export class RbacPolicyChangeService {
  constructor(
    private readonly snapshotService: RbacPolicySnapshotService,
    @InjectRepository(RbacPolicyState)
    private readonly policyStateRepository: Repository<RbacPolicyState>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  /**
   * Runs `change` and `version + 1` in one transaction:
   *
   * 1. Locks the `rbac_policy_state` row (`SELECT ... FOR UPDATE`). Admin
   *    changes run one at a time, so two admins can't each remove the other
   *    and both pass the check below.
   * 2. Runs `change`. It must write through the injected repositories, so
   *    its queries join this transaction.
   * 3. Reads the resulting policy (uncommitted rows included) and builds a
   *    snapshot: an invalid graph throws, and so does a policy where no
   *    `active` user holds `rbac@manage`. A blocked or deleted admin can't
   *    log in, so they don't count.
   * 4. Increments the version, so every instance reloads its snapshot.
   *
   * Any throw rolls back both the change and the version.
   */
  @Transactional()
  async apply<T>(change: () => Promise<T>): Promise<RbacPolicyChangeResult<T>> {
    const state = await this.policyStateRepository.findOne({
      where: { id: POLICY_STATE_ID },
      lock: { mode: 'pessimistic_write' },
    });
    if (!state) {
      throw new Error('rbac_policy_state row is missing, run the migrations');
    }

    const result = await change();

    const snapshot = buildPolicySnapshot(
      await this.snapshotService.readPolicyRows(),
    );
    if (!(await this.hasActiveRbacManager(snapshot))) {
      throw new RbacManageInvariantError();
    }

    const version = state.version + 1;
    await this.policyStateRepository.update(POLICY_STATE_ID, { version });

    return { result, version };
  }

  private async hasActiveRbacManager(
    snapshot: RbacPolicySnapshot,
  ): Promise<boolean> {
    const managerIds = findRbacManagerIds(snapshot);
    if (managerIds.length === 0) {
      return false;
    }
    return this.usersRepository.existsBy({
      id: In(managerIds),
      status: UserStatus.ACTIVE,
    });
  }
}
