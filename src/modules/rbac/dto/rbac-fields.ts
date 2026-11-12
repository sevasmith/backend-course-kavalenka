import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Role, permission and action names (`task.md`): 1 to 64 characters, a
 * lowercase letter first, then lowercase letters, digits, `.`, `_` or `-`.
 */
export const RBAC_NAME_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;

export const RBAC_DESCRIPTION_MAX_LENGTH = 500;

/** Trims and lowercases a string; leaves other types for the validators. */
export function normalizeRbacName(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

/**
 * Normalizes, then validates a name. The DB unique constraint compares the
 * stored, normalized value, so `Admin` and ` admin ` collide with `admin`.
 */
export const IsRbacName = () =>
  applyDecorators(
    Transform(({ value }: { value: unknown }) => normalizeRbacName(value)),
    IsString(),
    Matches(RBAC_NAME_PATTERN, {
      message:
        '$property must be 1-64 characters: a lowercase letter, then lowercase letters, digits, ".", "_" or "-"',
    }),
  );

/**
 * An optional description: trimmed, at most 500 characters, and an empty
 * string becomes `null`, so "no description" has a single representation.
 */
export const IsRbacDescription = () =>
  applyDecorators(
    Transform(({ value }: { value: unknown }) => {
      if (typeof value !== 'string') {
        return value;
      }
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    }),
    IsOptional(),
    IsString(),
    MaxLength(RBAC_DESCRIPTION_MAX_LENGTH),
  );
