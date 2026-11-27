import { currentRequestId } from './request-context';

/**
 * The fixed log categories of every refused request (1.3 §1.5). The client
 * always gets a neutral body (`invalid_session`, `permission_denied`, ...);
 * only the log says why. A fixed list keeps the names the same in every
 * guard, so one search (`category=expired`) finds every such refusal.
 */

/** 401: why there is no valid session. */
export const UnauthorizedCategory = {
  /** No access cookie (or an empty one). */
  MISSING: 'missing',
  /** Not a JWT at all. */
  MALFORMED: 'malformed',
  /** Wrong signature, key or algorithm. */
  SIGNATURE: 'signature',
  EXPIRED: 'expired',
  /** `sub`, `iss`, `aud`, `iat` or `exp` missing or wrong. */
  CLAIMS: 'claims',
  /** A refresh token where an access token is expected. */
  TOKEN_USE: 'token_use',
  /** The user from `sub` doesn't exist or isn't `active`. */
  USER_INACTIVE: 'user_inactive',
} as const;

/** 403: an active user, but this request is not allowed. */
export const ForbiddenCategory = {
  PERMISSION_DENIED: 'permission_denied',
  OWNERSHIP_DENIED: 'ownership_denied',
  CSRF_REJECTED: 'csrf_rejected',
} as const;

/** 503: which dependency made the access decision impossible. */
export const UnavailableCategory = {
  /** The users DB (reading the user's status). */
  USERS: 'users',
  /** `rbac_policy_state.version` could not be read. */
  RBAC_VERSION: 'rbac_version',
  /** The RBAC snapshot could not be loaded or is invalid. */
  RBAC_SNAPSHOT: 'rbac_snapshot',
  /** The route has no valid access declaration. */
  ROUTE_CONFIGURATION: 'route_configuration',
} as const;

export type UnauthorizedCategory =
  (typeof UnauthorizedCategory)[keyof typeof UnauthorizedCategory];
export type ForbiddenCategory =
  (typeof ForbiddenCategory)[keyof typeof ForbiddenCategory];
export type UnavailableCategory =
  (typeof UnavailableCategory)[keyof typeof UnavailableCategory];

/** A status always comes with a category from its own list. */
export type Refusal =
  | { status: 401; category: UnauthorizedCategory }
  | { status: 403; category: ForbiddenCategory }
  | { status: 503; category: UnavailableCategory };

/**
 * Extra fields of a refusal line. Only ids and fixed names: never a token,
 * cookie, header, body or role list.
 */
export type RefusalFields = Record<string, string | number | undefined>;

/**
 * One line per refusal:
 * `access.refused status=401 category=expired ... requestId=<id>`.
 *
 * `requestId` is taken from the request context, so a caller can't forget
 * it. Fields that are `undefined` are left out.
 */
export function formatRefusal(
  refusal: Refusal,
  fields: RefusalFields = {},
): string {
  const all: RefusalFields = {
    status: refusal.status,
    category: refusal.category,
    ...fields,
    requestId: currentRequestId(),
  };
  const pairs = Object.entries(all)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`);
  return ['access.refused', ...pairs].join(' ');
}
