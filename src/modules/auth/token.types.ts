/**
 * The `token_use` claim. It tells an access token from a refresh token, so one
 * can never be accepted in place of the other.
 */
export const TokenUse = {
  ACCESS: 'access',
  REFRESH: 'refresh',
} as const;

export type TokenUse = (typeof TokenUse)[keyof typeof TokenUse];

/** Access token lifetime: 15 minutes. Also the access cookie's `Max-Age`. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
/** Refresh token lifetime: 30 days. Also the refresh cookie's `Max-Age`. */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Allowed difference between server clocks. It never extends the cookie. */
export const JWT_CLOCK_SKEW_SECONDS = 30;
/** The only accepted algorithm. Never taken from the token header. */
export const JWT_ALGORITHM = 'HS256';

/**
 * Why a token was rejected. Only for logs: the client always gets the same
 * `401`, whatever the reason.
 */
export const TokenFailure = {
  /** No token at all (no cookie or an empty one). */
  MISSING: 'missing',
  /** Not a JWT: wrong format, bad base64url or JSON, or not an object. */
  MALFORMED: 'malformed',
  /** Wrong signature, wrong key or an algorithm other than HS256. */
  SIGNATURE: 'signature',
  /** `exp` is in the past, even with the clock skew. */
  EXPIRED: 'expired',
  /** `sub`, `iss`, `aud`, `iat` or `exp` is missing or wrong. */
  CLAIMS: 'claims',
  /** A valid token of the other type (refresh instead of access, or back). */
  TOKEN_USE: 'token_use',
} as const;

export type TokenFailure = (typeof TokenFailure)[keyof typeof TokenFailure];

/** The claims this app puts into every access and refresh token. */
export interface TokenClaims {
  /** The user's id. */
  sub: string;
  iss: string;
  aud: string;
  /** Issued at, in seconds since the epoch. */
  iat: number;
  /** Expires at, in seconds since the epoch. */
  exp: number;
  token_use: TokenUse;
}

export type TokenVerification =
  | { ok: true; userId: string }
  | { ok: false; reason: TokenFailure };
