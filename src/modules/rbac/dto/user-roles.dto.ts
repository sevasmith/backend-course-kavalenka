import { Transform } from 'class-transformer';
import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

/**
 * Body of `PUT /admin/rbac/users/{userId}/roles`: the complete new set of
 * the user's roles. `[]` is allowed and removes all roles.
 */
export class UserRolesBodyDto {
  /**
   * Lowercased first: UUIDs are case-insensitive, so `ABC…` and `abc…` are
   * the same role and must count as a repeat (400), not reach the DB as two
   * rows and fail on the primary key.
   */
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((id: unknown) =>
          typeof id === 'string' ? id.toLowerCase() : id,
        )
      : value,
  )
  @IsArray()
  @IsUUID(undefined, {
    each: true,
    message: 'each value in roleIds must be a UUID',
  })
  @ArrayUnique(undefined, { message: 'roleIds must not contain repeats' })
  roleIds: string[];
}

/** The response of both GET and PUT: ids only, no user profile fields. */
export interface UserRolesResponse {
  userId: string;
  roleIds: string[];
}

/** Sorted, so the same set always looks the same. */
export function toUserRolesResponse(
  userId: string,
  roleIds: readonly string[],
): UserRolesResponse {
  return { userId, roleIds: [...roleIds].sort() };
}
