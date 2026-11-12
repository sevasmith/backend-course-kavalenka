import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * Role, permission and action names (`task.md`): 1 to 64 characters, a
 * lowercase letter first, then lowercase letters, digits, `.`, `_` or `-`.
 */
export const RBAC_NAME_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;

export const RBAC_DESCRIPTION_MAX_LENGTH = 500;

export const RBAC_MAX_ACTIONS = 64;

const RBAC_NAME_MESSAGE =
  'must be 1-64 characters: a lowercase letter, then lowercase letters, digits, ".", "_" or "-"';

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
      message: `$property ${RBAC_NAME_MESSAGE}`,
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

/**
 * A list of action names: each one normalized and validated like a name,
 * 1 to 64 of them, no repeats after normalization (`Read` and `read` are the
 * same action, so sending both is a 400, not a silent merge).
 */
export const IsRbacActionList = () =>
  applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      Array.isArray(value) ? value.map(normalizeRbacName) : value,
    ),
    IsArray(),
    ArrayMinSize(1),
    ArrayMaxSize(RBAC_MAX_ACTIONS),
    IsString({ each: true }),
    Matches(RBAC_NAME_PATTERN, {
      each: true,
      message: `each value in $property ${RBAC_NAME_MESSAGE}`,
    }),
    ArrayUnique(undefined, { message: '$property must not contain repeats' }),
  );
