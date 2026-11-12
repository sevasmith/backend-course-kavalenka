import { Permission } from '../permission.entity';
import { IsRbacActionList, IsRbacDescription, IsRbacName } from './rbac-fields';

/**
 * Body of `POST /admin/rbac/permissions` and
 * `PUT /admin/rbac/permissions/{permissionId}`. PUT is a full replacement:
 * `actions` is the complete new set, and a missing `description` clears it.
 */
export class PermissionBodyDto {
  @IsRbacName()
  name: string;

  @IsRbacDescription()
  description?: string | null;

  @IsRbacActionList()
  actions: string[];
}

/** The permission as the API returns it, with its action names. */
export interface PermissionResponse {
  id: string;
  name: string;
  description: string | null;
  actions: string[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Copies the fields one by one, so a new entity column never leaks.
 * Actions are sorted, so the same set always looks the same.
 */
export function toPermissionResponse(
  permission: Permission,
  actions: readonly string[],
): PermissionResponse {
  return {
    id: permission.id,
    name: permission.name,
    description: permission.description,
    actions: [...actions].sort(),
    createdAt: permission.createdAt,
    updatedAt: permission.updatedAt,
  };
}
