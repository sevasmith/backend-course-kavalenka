import { Role } from '../role.entity';
import { IsRbacDescription, IsRbacName } from './rbac-fields';

/**
 * Body of `POST /admin/rbac/roles` and `PUT /admin/rbac/roles/{roleId}`.
 * PUT is a full replacement: a missing `description` clears it.
 */
export class RoleBodyDto {
  @IsRbacName()
  name: string;

  @IsRbacDescription()
  description?: string | null;
}

/** The role as the API returns it: only role fields, nothing else. */
export interface RoleResponse {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
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
