import { ApiProperty } from '@nestjs/swagger';

import { Permission } from '../permission.entity';
import { IsRbacActionList, IsRbacDescription, IsRbacName } from './rbac-fields';

/**
 * Body of `POST /admin/rbac/permissions` and
 * `PUT /admin/rbac/permissions/{permissionId}`. PUT is a full replacement:
 * `actions` is the complete new set, and a missing `description` clears it.
 */
export class PermissionBodyDto {
  @IsRbacName('users')
  name: string;

  @IsRbacDescription()
  description?: string | null;

  @IsRbacActionList()
  actions: string[];
}

/** The permission as the API returns it, with its action names. */
export class PermissionResponse {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'users' })
  name: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ type: [String], example: ['list', 'read'] })
  actions: string[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
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
