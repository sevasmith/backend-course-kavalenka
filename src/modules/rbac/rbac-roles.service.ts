import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  isForeignKeyViolation,
  isUniqueViolation,
} from '@/core/database/pg-errors';
import { RoleBodyDto, RoleResponse, toRoleResponse } from './dto/role.dto';
import { Grant } from './grant.entity';
import { RbacPolicyChangeService } from './rbac-policy-change.service';
import { Role } from './role.entity';
import { UserRole } from './user-role.entity';

/**
 * CRUD for roles (`/admin/rbac/roles`). Every write goes through
 * `RbacPolicyChangeService.apply`: one transaction with `version + 1`.
 *
 * The 404/409 exceptions are thrown inside `apply`, so they also roll back
 * the transaction and the version is not bumped for a rejected change.
 */
@Injectable()
export class RbacRolesService {
  constructor(
    private readonly policyChange: RbacPolicyChangeService,
    @InjectRepository(Role)
    private readonly rolesRepository: Repository<Role>,
    @InjectRepository(Grant)
    private readonly grantsRepository: Repository<Grant>,
    @InjectRepository(UserRole)
    private readonly userRolesRepository: Repository<UserRole>,
  ) {}

  async list(): Promise<RoleResponse[]> {
    const roles = await this.rolesRepository.find({ order: { name: 'ASC' } });
    return roles.map(toRoleResponse);
  }

  create(dto: RoleBodyDto): Promise<RoleResponse> {
    return this.withNameConflict(async () => {
      const { result } = await this.policyChange.apply(() =>
        this.rolesRepository.save(
          this.rolesRepository.create({
            name: dto.name,
            description: dto.description ?? null,
          }),
        ),
      );
      return toRoleResponse(result);
    });
  }

  /** Full replacement: a missing `description` becomes `null`. */
  replace(roleId: string, dto: RoleBodyDto): Promise<RoleResponse> {
    return this.withNameConflict(async () => {
      const { result } = await this.policyChange.apply(async () => {
        const role = await this.findOrFail(roleId);
        role.name = dto.name;
        role.description = dto.description ?? null;
        return this.rolesRepository.save(role);
      });
      return toRoleResponse(result);
    });
  }

  /**
   * Only an unused role can be deleted. The check comes first, so the DB
   * cascade from roles to grants never fires through the API.
   */
  async delete(roleId: string): Promise<void> {
    try {
      await this.policyChange.apply(async () => {
        await this.findOrFail(roleId);

        const [hasGrants, hasUsers] = await Promise.all([
          this.grantsRepository.existsBy({ roleId }),
          this.userRolesRepository.existsBy({ roleId }),
        ]);
        if (hasGrants || hasUsers) {
          throw new ConflictException('Role is in use');
        }

        await this.rolesRepository.delete(roleId);
      });
    } catch (error) {
      // A user got the role between the check and the delete (e.g. a
      // registration, which doesn't take the admin lock): `user_roles`
      // restricts the delete.
      if (isForeignKeyViolation(error)) {
        throw new ConflictException('Role is in use');
      }
      throw error;
    }
  }

  private async findOrFail(roleId: string): Promise<Role> {
    const role = await this.rolesRepository.findOneBy({ id: roleId });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    return role;
  }

  /**
   * The unique constraint on `roles.name` is the source of truth for
   * duplicates: a "does it exist?" check before the insert would race.
   * Caught after `apply`, when the transaction is already rolled back.
   */
  private async withNameConflict<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Role name is already taken');
      }
      throw error;
    }
  }
}
