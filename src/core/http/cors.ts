import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { ConfigService } from '@/core/config/config.service';
import { CSRF_HEADER } from './csrf.guard';

/**
 * CORS for trusted frontends on another origin. Shared by `main.ts` and the
 * e2e test app, so the tests check the same preflight a browser gets.
 *
 * - `origin`: only the exact origins from `TRUSTED_ORIGINS`, never `*` (a
 *   wildcard can't be combined with credentials). An empty list (frontend
 *   on the same origin) allows no cross-origin requests.
 * - `credentials`: the browser may send the auth cookies.
 * - `allowedHeaders`: only what the API reads. `X-CSRF-Protection` must be
 *   here, or the preflight blocks it and every cross-origin POST fails the
 *   CSRF check. Without this list the plugin would allow any header the
 *   browser asks for.
 *
 * CORS only decides which pages may read responses and send these headers.
 * It doesn't block requests on the server: `CsrfGuard` does that.
 */
export function setupCors(app: NestFastifyApplication): void {
  const configService = app.get(ConfigService);

  app.enableCors({
    origin: configService.get('TRUSTED_ORIGINS'),
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', CSRF_HEADER],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });
}
