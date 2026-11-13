import { IsUUID } from 'class-validator';

import { Grant } from '../grant.entity';
import { IsOptionalRbacActionList } from './rbac-fields';

/**
 * Body of `POST /admin/rbac/grants` and `PUT /admin/rbac/grants/{grantId}`.
 * PUT is a full replacement: a missing `actions` there also means
 * "all actions", not "keep the current ones".
 */
export class GrantBodyDto {
  @IsUUID(undefined, { message: 'roleId must be a UUID' })
  roleId: string;

  @IsUUID(undefined, { message: 'permissionId must be a UUID' })
  permissionId: string;

  /** Missing or `[]` → all actions; otherwise only these actions. */
  @IsOptionalRbacActionList()
  actions?: string[];
}

/** The grant as the API returns it. */
export interface GrantResponse {
  id: string;
  roleId: string;
  permissionId: string;
  allActions: boolean;
  /** Always `[]` when `allActions` is true. */
  actions: string[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Copies the fields one by one, so a new entity column never leaks.
 * Actions are sorted, so the same set always looks the same.
 */
export function toGrantResponse(
  grant: Grant,
  actions: readonly string[],
): GrantResponse {
  return {
    id: grant.id,
    roleId: grant.roleId,
    permissionId: grant.permissionId,
    allActions: grant.allActions,
    actions: grant.allActions ? [] : [...actions].sort(),
    createdAt: grant.createdAt,
    updatedAt: grant.updatedAt,
  };
}
