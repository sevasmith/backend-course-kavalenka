import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { User } from '@/modules/users/user.entity';
import {
  toUserRolesResponse,
  UserRolesBodyDto,
  UserRolesResponse,
} from './dto/user-roles.dto';
import { RbacPolicyChangeService } from './rbac-policy-change.service';
import { Role } from './role.entity';
import { UserRole } from './user-role.entity';

/**
 * Reads and replaces a user's roles (`/admin/rbac/users/{userId}/roles`).
 *
 * The replacement goes through `RbacPolicyChangeService.apply`: one
 * transaction with `version + 1`, and the `rbac@manage` check runs on the
 * result, so taking `admin` away from the last admin is rolled back.
 */
@Injectable()
export class RbacUserRolesService {
  constructor(
    private readonly policyChange: RbacPolicyChangeService,
    @InjectRepository(UserRole)
    private readonly userRolesRepository: Repository<UserRole>,
    @InjectRepository(Role)
    private readonly rolesRepository: Repository<Role>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async get(userId: string): Promise<UserRolesResponse> {
    await this.assertUserExists(userId);
    const rows = await this.userRolesRepository.findBy({ userId });
    return toUserRolesResponse(
      userId,
      rows.map((row) => row.roleId),
    );
  }

  /**
   * Full replacement: the old links are deleted, the new ones inserted.
   * @throws 404 if the user or any of the roles doesn't exist.
   */
  async replace(
    userId: string,
    dto: UserRolesBodyDto,
  ): Promise<UserRolesResponse> {
    await this.policyChange.apply(async () => {
      await this.assertUserExists(userId);
      await this.assertRolesExist(dto.roleIds);

      await this.userRolesRepository.delete({ userId });
      if (dto.roleIds.length > 0) {
        await this.userRolesRepository.insert(
          dto.roleIds.map((roleId) => ({ userId, roleId })),
        );
      }
    });
    return toUserRolesResponse(userId, dto.roleIds);
  }

  private async assertUserExists(userId: string): Promise<void> {
    if (!(await this.usersRepository.existsBy({ id: userId }))) {
      throw new NotFoundException('User not found');
    }
  }

  /** The DTO already rejected repeats, so a lower count means a missing role. */
  private async assertRolesExist(roleIds: readonly string[]): Promise<void> {
    if (roleIds.length === 0) {
      return;
    }
    const found = await this.rolesRepository.countBy({ id: In(roleIds) });
    if (found !== roleIds.length) {
      throw new NotFoundException('Role not found');
    }
  }
}
