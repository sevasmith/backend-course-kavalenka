import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

import { Grant } from '../grant.entity';
import { IsOptionalRbacActionList } from './rbac-fields';

/**
 * Body of `POST /admin/rbac/grants` and `PUT /admin/rbac/grants/{grantId}`.
 * PUT is a full replacement: a missing `actions` there also means
 * "all actions", not "keep the current ones".
 */
export class GrantBodyDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID(undefined, { message: 'roleId must be a UUID' })
  roleId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID(undefined, { message: 'permissionId must be a UUID' })
  permissionId: string;

  /** Missing or `[]` → all actions; otherwise only these actions. */
  @IsOptionalRbacActionList()
  actions?: string[];
}

/** The grant as the API returns it. */
export class GrantResponse {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  roleId: string;

  @ApiProperty({ format: 'uuid' })
  permissionId: string;

  @ApiProperty({
    description: 'True when the grant covers every action of the permission.',
  })
  allActions: boolean;

  @ApiProperty({
    type: [String],
    example: ['read'],
    description: 'Always `[]` when `allActions` is true.',
  })
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
