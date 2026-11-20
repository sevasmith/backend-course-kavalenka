import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RbacPolicyChangeService } from './rbac-policy-change.service';
import { Role } from './role.entity';
import { UserRole } from './user-role.entity';

/** The role every user gets when their account becomes `active`. */
export const DEFAULT_ROLE_NAME = 'user';

export type DefaultRoleOutcome =
  | 'assigned'
  | 'already_assigned'
  /** The `user` role doesn't exist: RBAC isn't bootstrapped yet. */
  | 'rbac_not_initialized';

/**
 * Gives a newly active user the `user` role. Registration calls it inside
 * the transaction that sets `status = active`, so a user is never active
 * without the role, and a failed role insert rolls the activation back.
 *
 * The set of rights is chosen here, by RBAC, never by the request.
 */
@Injectable()
export class RbacDefaultRoleService {
  private readonly logger = new Logger(RbacDefaultRoleService.name);

  constructor(
    private readonly policyChange: RbacPolicyChangeService,
    @InjectRepository(Role)
    private readonly rolesRepository: Repository<Role>,
    @InjectRepository(UserRole)
    private readonly userRolesRepository: Repository<UserRole>,
  ) {}

  /**
   * Must be called inside the caller's transaction (`@Transactional`):
   * `applyAddition` joins it, so the role and `version + 1` commit together with
   * the activation.
   *
   * Skips without an error when the `user` role doesn't exist (`task.md`:
   * only "if the RBAC module is initialized") or the link already exists.
   */
  async assignToActivatedUser(userId: string): Promise<DefaultRoleOutcome> {
    const role = await this.rolesRepository.findOneBy({
      name: DEFAULT_ROLE_NAME,
    });
    if (!role) {
      this.logger.warn(
        `Default role skipped, reason=rbac_not_initialized, userId=${userId}`,
      );
      return 'rbac_not_initialized';
    }

    if (await this.userRolesRepository.existsBy({ userId, roleId: role.id })) {
      return 'already_assigned';
    }

    // Adds a right and removes none, so the `rbac@manage` check is skipped:
    // registration must not depend on the admin's status.
    const { version } = await this.policyChange.applyAddition(() =>
      this.userRolesRepository.insert({ userId, roleId: role.id }),
    );
    this.logger.log(
      `Default role assigned, userId=${userId}, policyVersion=${version}`,
    );
    return 'assigned';
  }
}
