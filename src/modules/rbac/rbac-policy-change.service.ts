import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';

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
 * The change would leave no user with `rbac@manage`. The whole transaction
 * is rolled back; the API answers 409 `conflict` (mapped in task 15).
 */
export class RbacManageInvariantError extends Error {
  constructor() {
    super('The change would leave no user with rbac@manage');
    this.name = RbacManageInvariantError.name;
  }
}

export interface RbacPolicyChangeResult<T> {
  /** What the change callback returned (e.g. the created role). */
  result: T;
  /** The new `rbac_policy_state.version`, for responses and audit logs. */
  version: number;
}

/** `true` if at least one user may do `rbac@manage` in this snapshot. */
export function hasRbacManager(snapshot: RbacPolicySnapshot): boolean {
  for (const userId of snapshot.userRoles.keys()) {
    if (
      isAllowed(snapshot, userId, RBAC_MANAGE.permission, RBAC_MANAGE.action)
    ) {
      return true;
    }
  }
  return false;
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
   *    snapshot: an invalid graph or no `rbac@manage` holder throws.
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
    if (!hasRbacManager(snapshot)) {
      throw new RbacManageInvariantError();
    }

    const version = state.version + 1;
    await this.policyStateRepository.update(POLICY_STATE_ID, { version });

    return { result, version };
  }
}
