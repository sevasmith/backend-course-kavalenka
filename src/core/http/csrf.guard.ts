import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { ConfigService } from '@/core/config/config.service';
import { apiError, ErrorCode } from './api-error';

/** The custom header a trusted cross-origin frontend sends (`task.md`). */
export const CSRF_HEADER = 'X-CSRF-Protection';
const CSRF_HEADER_VALUE = '1';

/** Methods that never change state: no CSRF check (1.2: GET changes nothing). */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for every state-changing request (POST, PUT, PATCH,
 * DELETE), including the `@Public()` auth routes (`task.md`, security chain
 * step 3; 1.2 "Cookies, CORS, and CSRF").
 *
 * - No `Origin` header: passes. Browsers always send `Origin` on a
 *   cross-origin POST/PUT/PATCH/DELETE, so a request without it isn't a
 *   cross-site forgery; it comes from a non-browser client (curl, tests).
 * - Same origin (`Origin` host equals the `Host` header): passes.
 * - Another origin: the exact `Origin` must be in `TRUSTED_ORIGINS` and the
 *   request must carry `X-CSRF-Protection: 1`. Otherwise 403 `csrf_rejected`.
 *   This holds even for a same-site origin (`app.example.com` calling
 *   `api.example.com`): `SameSite=Strict` doesn't stop a compromised
 *   neighbouring subdomain.
 *
 * Why the custom header helps: a page can't add it to a cross-origin request
 * without a CORS preflight, and the preflight succeeds only for an origin in
 * the CORS allowlist (see `cors.ts`).
 *
 * Registered in `AppModule` after `AccessCheckGuard` and before `RbacGuard`,
 * the chain order from 1.3: access, status, CSRF, RBAC.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly logger = new Logger(CsrfGuard.name);
  private readonly trustedOrigins: ReadonlySet<string>;

  constructor(configService: ConfigService) {
    this.trustedOrigins = new Set(configService.get('TRUSTED_ORIGINS'));
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    if (SAFE_METHODS.has(request.method)) {
      return true;
    }

    const origin = request.headers.origin;
    if (origin === undefined) {
      return true;
    }
    if (isSameOrigin(origin, request.headers.host)) {
      return true;
    }

    if (!this.trustedOrigins.has(origin)) {
      this.reject('untrusted_origin', request);
    }
    if (request.headers[CSRF_HEADER.toLowerCase()] !== CSRF_HEADER_VALUE) {
      this.reject('missing_csrf_header', request);
    }
    return true;
  }

  /** Logs only the reason and the request id: no origin, URL or headers. */
  private reject(reason: string, request: FastifyRequest): never {
    this.logger.warn(
      `CSRF rejected, reason=${reason}, requestId=${request.id}`,
    );
    throw new ForbiddenException(
      apiError(ErrorCode.CSRF_REJECTED, 'Cross-origin request rejected'),
    );
  }
}

/**
 * `Origin` names the page that sent the request, `Host` the server it was
 * sent to. Equal hosts mean the page and the API share one origin.
 *
 * Only the host (with port) is compared, not the scheme: behind a proxy that
 * ends TLS, the API itself sees plain HTTP. If a proxy rewrites `Host`, a
 * same-origin request just looks cross-origin and must pass the full check,
 * so this fails closed. An `Origin` of `null` (sandboxed page, some
 * redirects) isn't a URL and is treated as untrusted.
 */
function isSameOrigin(origin: string, host: string | undefined): boolean {
  if (!host) {
    return false;
  }
  try {
    return new URL(origin).host === host.toLowerCase();
  } catch {
    return false;
  }
}
