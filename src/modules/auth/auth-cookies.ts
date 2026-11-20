import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply } from 'fastify';
import { ACCESS_TOKEN_COOKIE } from '@/core/http/openapi';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
} from './token.types';

export { ACCESS_TOKEN_COOKIE };

/** The cookie that carries the refresh token (`task.md`, Authentication). */
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

/**
 * The browser sends the refresh cookie only to this path, so it never travels
 * with ordinary API requests.
 */
export const REFRESH_TOKEN_COOKIE_PATH = '/auth/refresh';

/**
 * Attributes shared by both cookies:
 * - `httpOnly`: JavaScript can't read the token, so an XSS can't steal it.
 * - `secure`: sent only over HTTPS.
 * - `sameSite: 'strict'`: not sent with requests started by other sites.
 * - no `domain`: a host-only cookie, never sent to subdomains.
 */
const BASE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
} as const satisfies CookieSerializeOptions;

const ACCESS_OPTIONS: CookieSerializeOptions = {
  ...BASE_OPTIONS,
  path: '/',
};

const REFRESH_OPTIONS: CookieSerializeOptions = {
  ...BASE_OPTIONS,
  path: REFRESH_TOKEN_COOKIE_PATH,
};

/** Adds both `Set-Cookie` headers. `Max-Age` equals each token's TTL. */
export function setAuthCookies(
  reply: FastifyReply,
  accessToken: string,
  refreshToken: string,
): void {
  reply.setCookie(ACCESS_TOKEN_COOKIE, accessToken, {
    ...ACCESS_OPTIONS,
    maxAge: ACCESS_TOKEN_TTL_SECONDS,
  });
  reply.setCookie(REFRESH_TOKEN_COOKIE, refreshToken, {
    ...REFRESH_OPTIONS,
    maxAge: REFRESH_TOKEN_TTL_SECONDS,
  });
}

/**
 * Clears both cookies. The browser deletes a cookie only when the name,
 * `Path` and `Domain` match the original, so the same options are reused.
 * `clearCookie` adds an empty value, `Max-Age=0` and a past `Expires`.
 */
export function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie(ACCESS_TOKEN_COOKIE, ACCESS_OPTIONS);
  reply.clearCookie(REFRESH_TOKEN_COOKIE, REFRESH_OPTIONS);
}
