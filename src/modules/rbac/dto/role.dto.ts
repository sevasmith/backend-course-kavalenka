import { ApiProperty } from '@nestjs/swagger';

import { Role } from '../role.entity';
import { IsRbacDescription, IsRbacName } from './rbac-fields';

/**
 * Body of `POST /admin/rbac/roles` and `PUT /admin/rbac/roles/{roleId}`.
 * PUT is a full replacement: a missing `description` clears it.
 */
export class RoleBodyDto {
  @IsRbacName('editor')
  name: string;

  @IsRbacDescription()
  description?: string | null;
}

/**
 * The role as the API returns it: only role fields, nothing else. A class,
 * not an interface, so Swagger can read its fields at runtime.
 */
export class RoleResponse {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'editor' })
  name: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

/** Copies the fields one by one, so a new entity column never leaks. */
export function toRoleResponse(role: Role): RoleResponse {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}
