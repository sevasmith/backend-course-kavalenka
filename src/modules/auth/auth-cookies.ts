import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply } from 'fastify';
import type { AuthCookieSameSite } from '@/core/config/config.types';
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
 * - `secure`: sent only over HTTPS. Always on, and required by browsers for
 *   `SameSite=None`.
 * - `sameSite`: `strict` by default, so the cookies aren't sent with
 *   requests started by other sites. `none` only for a trusted frontend on
 *   another site (`AUTH_COOKIE_SAME_SITE`); the CSRF check then protects the
 *   state-changing requests.
 * - no `domain`: a host-only cookie, never sent to subdomains.
 */
function cookieOptions(
  path: string,
  sameSite: AuthCookieSameSite,
): CookieSerializeOptions {
  return { httpOnly: true, secure: true, sameSite, path };
}

/** Adds both `Set-Cookie` headers. `Max-Age` equals each token's TTL. */
export function setAuthCookies(
  reply: FastifyReply,
  accessToken: string,
  refreshToken: string,
  sameSite: AuthCookieSameSite,
): void {
  reply.setCookie(ACCESS_TOKEN_COOKIE, accessToken, {
    ...cookieOptions('/', sameSite),
    maxAge: ACCESS_TOKEN_TTL_SECONDS,
  });
  reply.setCookie(REFRESH_TOKEN_COOKIE, refreshToken, {
    ...cookieOptions(REFRESH_TOKEN_COOKIE_PATH, sameSite),
    maxAge: REFRESH_TOKEN_TTL_SECONDS,
  });
}

/**
 * Clears both cookies. The browser deletes a cookie only when the name,
 * `Path` and `Domain` match the original, so the same options are reused
 * (`SameSite` too: for a cross-site frontend a `Strict` clearing cookie
 * wouldn't be accepted from a cross-site request).
 * `clearCookie` adds an empty value, `Max-Age=0` and a past `Expires`.
 */
export function clearAuthCookies(
  reply: FastifyReply,
  sameSite: AuthCookieSameSite,
): void {
  reply.clearCookie(ACCESS_TOKEN_COOKIE, cookieOptions('/', sameSite));
  reply.clearCookie(
    REFRESH_TOKEN_COOKIE,
    cookieOptions(REFRESH_TOKEN_COOKIE_PATH, sameSite),
  );
}
