import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import {
  isForeignKeyViolation,
  isUniqueViolation,
} from '@/core/database/pg-errors';
import {
  PermissionBodyDto,
  PermissionResponse,
  toPermissionResponse,
} from './dto/permission.dto';
import { Grant } from './grant.entity';
import { GrantAction } from './grant-action.entity';
import { Permission } from './permission.entity';
import { PermissionAction } from './permission-action.entity';
import { RbacPolicyChangeService } from './rbac-policy-change.service';

const ACTION_IN_USE = 'An action being removed is part of a grant';

/**
 * CRUD for permissions and their actions (`/admin/rbac/permissions`).
 * Every write goes through `RbacPolicyChangeService.apply`: one transaction
 * with `version + 1` and the `rbac@manage` check (so renaming `rbac` or
 * removing `manage` from it can't lock everybody out).
 */
@Injectable()
export class RbacPermissionsService {
  constructor(
    private readonly policyChange: RbacPolicyChangeService,
    @InjectRepository(Permission)
    private readonly permissionsRepository: Repository<Permission>,
    @InjectRepository(PermissionAction)
    private readonly permissionActionsRepository: Repository<PermissionAction>,
    @InjectRepository(Grant)
    private readonly grantsRepository: Repository<Grant>,
    @InjectRepository(GrantAction)
    private readonly grantActionsRepository: Repository<GrantAction>,
  ) {}

  async list(): Promise<PermissionResponse[]> {
    const permissions = await this.permissionsRepository.find({
      order: { name: 'ASC' },
    });
    const actions = await this.permissionActionsRepository.find();

    const actionsByPermission = new Map<string, string[]>();
    for (const action of actions) {
      const names = actionsByPermission.get(action.permissionId) ?? [];
      names.push(action.name);
      actionsByPermission.set(action.permissionId, names);
    }

    return permissions.map((permission) =>
      toPermissionResponse(
        permission,
        actionsByPermission.get(permission.id) ?? [],
      ),
    );
  }

  create(dto: PermissionBodyDto): Promise<PermissionResponse> {
    return this.withNameConflict(async () => {
      const { result } = await this.policyChange.apply(async () => {
        const permission = await this.permissionsRepository.save(
          this.permissionsRepository.create({
            name: dto.name,
            description: dto.description ?? null,
          }),
        );
        await this.permissionActionsRepository.insert(
          dto.actions.map((name) => ({ permissionId: permission.id, name })),
        );
        return permission;
      });
      return toPermissionResponse(result, dto.actions);
    });
  }

  /**
   * Full replacement of the fields and the action set. Kept actions keep
   * their row (and id), so explicit grants on them stay valid.
   *
   * - A removed action listed in `grant_actions` (an explicit grant) → 409.
   * - Grants with `all_actions` don't block it: they have no rows for it,
   *   simply cover what is left, and also cover the added actions.
   */
  async replace(
    permissionId: string,
    dto: PermissionBodyDto,
  ): Promise<PermissionResponse> {
    try {
      return await this.withNameConflict(async () => {
        const { result } = await this.policyChange.apply(async () => {
          await this.findOrFail(permissionId);
          await this.replaceActions(permissionId, dto.actions);

          // `update` always sets `updated_at`, also when only actions changed.
          await this.permissionsRepository.update(permissionId, {
            name: dto.name,
            description: dto.description ?? null,
          });
          return this.findOrFail(permissionId);
        });
        return toPermissionResponse(result, dto.actions);
      });
    } catch (error) {
      // Safety net: `grant_actions` restricts deleting a used action.
      if (isForeignKeyViolation(error)) {
        throw new ConflictException(ACTION_IN_USE);
      }
      throw error;
    }
  }

  /**
   * Only a permission without grants can be deleted. `grants` cascades from
   * permissions in the DB, so this check is what keeps roles from losing
   * rights silently. Its actions are deleted by the cascade.
   */
  async delete(permissionId: string): Promise<void> {
    await this.policyChange.apply(async () => {
      await this.findOrFail(permissionId);

      if (await this.grantsRepository.existsBy({ permissionId })) {
        throw new ConflictException('Permission is in use');
      }

      await this.permissionsRepository.delete(permissionId);
    });
  }

  /** Deletes the actions not in `wanted` and inserts the new ones. */
  private async replaceActions(
    permissionId: string,
    wanted: readonly string[],
  ): Promise<void> {
    const current = await this.permissionActionsRepository.findBy({
      permissionId,
    });
    const wantedNames = new Set(wanted);
    const currentNames = new Set(current.map((action) => action.name));

    const removedIds = current
      .filter((action) => !wantedNames.has(action.name))
      .map((action) => action.id);
    const added = wanted.filter((name) => !currentNames.has(name));

    if (removedIds.length > 0) {
      const usedByGrant = await this.grantActionsRepository.existsBy({
        permissionActionId: In(removedIds),
      });
      if (usedByGrant) {
        throw new ConflictException(ACTION_IN_USE);
      }
      await this.permissionActionsRepository.delete({ id: In(removedIds) });
    }

    if (added.length > 0) {
      await this.permissionActionsRepository.insert(
        added.map((name) => ({ permissionId, name })),
      );
    }
  }

  private async findOrFail(permissionId: string): Promise<Permission> {
    const permission = await this.permissionsRepository.findOneBy({
      id: permissionId,
    });
    if (!permission) {
      throw new NotFoundException('Permission not found');
    }
    return permission;
  }

  /** The unique constraint on `permissions.name` decides duplicates. */
  private async withNameConflict<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Permission name is already taken');
      }
      throw error;
    }
  }
}
