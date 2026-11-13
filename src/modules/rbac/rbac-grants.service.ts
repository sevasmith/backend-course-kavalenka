import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { isUniqueViolation } from '@/core/database/pg-errors';
import { GrantBodyDto, GrantResponse, toGrantResponse } from './dto/grant.dto';
import { Grant } from './grant.entity';
import { GrantAction } from './grant-action.entity';
import { Permission } from './permission.entity';
import { PermissionAction } from './permission-action.entity';
import { RbacPolicyChangeService } from './rbac-policy-change.service';
import { Role } from './role.entity';

/**
 * CRUD for grants (`/admin/rbac/grants`). The API and the DB describe
 * "all actions" differently:
 *
 * - API: `actions` missing or `[]` → `allActions: true, actions: []`.
 * - DB: `all_actions = true` and no `grant_actions` rows. An explicit grant
 *   has `all_actions = false` and one row per action.
 *
 * Every write goes through `RbacPolicyChangeService.apply` (one transaction,
 * `version + 1`, `rbac@manage` check), so narrowing or deleting the admin's
 * `rbac` grant can't lock everybody out.
 */
@Injectable()
export class RbacGrantsService {
  constructor(
    private readonly policyChange: RbacPolicyChangeService,
    @InjectRepository(Grant)
    private readonly grantsRepository: Repository<Grant>,
    @InjectRepository(GrantAction)
    private readonly grantActionsRepository: Repository<GrantAction>,
    @InjectRepository(Role)
    private readonly rolesRepository: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionsRepository: Repository<Permission>,
    @InjectRepository(PermissionAction)
    private readonly permissionActionsRepository: Repository<PermissionAction>,
  ) {}

  async list(): Promise<GrantResponse[]> {
    const grants = await this.grantsRepository.find({
      order: { createdAt: 'ASC' },
    });
    const grantActions = await this.grantActionsRepository.find();
    const actions = await this.permissionActionsRepository.find();

    const actionNames = new Map(actions.map((a) => [a.id, a.name]));
    const actionsByGrant = new Map<string, string[]>();
    for (const { grantId, permissionActionId } of grantActions) {
      const names = actionsByGrant.get(grantId) ?? [];
      names.push(actionNames.get(permissionActionId) ?? '');
      actionsByGrant.set(grantId, names);
    }

    return grants.map((grant) =>
      toGrantResponse(grant, actionsByGrant.get(grant.id) ?? []),
    );
  }

  create(dto: GrantBodyDto): Promise<GrantResponse> {
    return this.withPairConflict(async () => {
      const { result } = await this.policyChange.apply(async () => {
        const actionIds = await this.resolveTarget(dto);

        const grant = await this.grantsRepository.save(
          this.grantsRepository.create({
            roleId: dto.roleId,
            permissionId: dto.permissionId,
            allActions: actionIds === null,
          }),
        );
        await this.insertActions(grant.id, actionIds);
        return grant;
      });
      return toGrantResponse(result, dto.actions ?? []);
    });
  }

  /**
   * Full replacement: role, permission and actions. The grant keeps its id;
   * its old action rows are dropped and the new ones inserted.
   */
  replace(grantId: string, dto: GrantBodyDto): Promise<GrantResponse> {
    return this.withPairConflict(async () => {
      const { result } = await this.policyChange.apply(async () => {
        await this.findOrFail(grantId);
        const actionIds = await this.resolveTarget(dto);

        await this.grantActionsRepository.delete({ grantId });
        // `update` always sets `updated_at`, also when only actions changed.
        await this.grantsRepository.update(grantId, {
          roleId: dto.roleId,
          permissionId: dto.permissionId,
          allActions: actionIds === null,
        });
        await this.insertActions(grantId, actionIds);
        return this.findOrFail(grantId);
      });
      return toGrantResponse(result, dto.actions ?? []);
    });
  }

  /** 204 on success. Its `grant_actions` rows go with it (CASCADE). */
  async delete(grantId: string): Promise<void> {
    await this.policyChange.apply(async () => {
      await this.findOrFail(grantId);
      await this.grantsRepository.delete(grantId);
    });
  }

  /**
   * Checks what the grant points to and turns action names into
   * `permission_actions` ids.
   *
   * @returns `null` for "all actions", otherwise the ids of the listed actions.
   * @throws 404 if the role or permission doesn't exist; 400 if an action
   *   doesn't belong to the permission.
   */
  private async resolveTarget(dto: GrantBodyDto): Promise<string[] | null> {
    const [roleExists, permissionExists] = await Promise.all([
      this.rolesRepository.existsBy({ id: dto.roleId }),
      this.permissionsRepository.existsBy({ id: dto.permissionId }),
    ]);
    if (!roleExists) {
      throw new NotFoundException('Role not found');
    }
    if (!permissionExists) {
      throw new NotFoundException('Permission not found');
    }

    if (!dto.actions?.length) {
      return null;
    }

    const found = await this.permissionActionsRepository.findBy({
      permissionId: dto.permissionId,
      name: In(dto.actions),
    });
    // The DTO already rejected repeats, so a shorter result means unknown names.
    if (found.length !== dto.actions.length) {
      throw new BadRequestException(
        'An action does not belong to the permission',
      );
    }
    return found.map((action) => action.id);
  }

  private async insertActions(
    grantId: string,
    actionIds: string[] | null,
  ): Promise<void> {
    if (actionIds === null) {
      return;
    }
    await this.grantActionsRepository.insert(
      actionIds.map((permissionActionId) => ({ grantId, permissionActionId })),
    );
  }

  private async findOrFail(grantId: string): Promise<Grant> {
    const grant = await this.grantsRepository.findOneBy({ id: grantId });
    if (!grant) {
      throw new NotFoundException('Grant not found');
    }
    return grant;
  }

  /** The unique `(role_id, permission_id)` constraint decides duplicates. */
  private async withPairConflict<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'The role already has a grant for this permission',
        );
      }
      throw error;
    }
  }
}
