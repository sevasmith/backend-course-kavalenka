import { randomUUID } from 'node:crypto';

import { ClsModule, ClsServiceManager } from 'nestjs-cls';

/**
 * The request id (1.2: "the request identifier" in every audit event).
 *
 * Fastify gives each request an id (`request.id`); by default it is a
 * counter (`req-1`, `req-2`, ...) that starts over on every restart and
 * repeats across instances. A UUID is unique everywhere, so a log search
 * finds exactly one request. Passed as `genReqId` to every `FastifyAdapter`.
 */
export const generateRequestId = (): string => randomUUID();

/**
 * Makes the request id readable anywhere during a request, without passing
 * it through every method (like React Context instead of prop drilling).
 *
 * `nestjs-cls` mounts a middleware that wraps each request in an
 * `AsyncLocalStorage` context. Middleware runs before guards, so the guards,
 * the services and the exception filter all see the id. The id is Fastify's
 * `request.id` (Nest copies it onto the raw request the middleware gets), so
 * code that reads `request.id` directly logs the same value.
 */
export const RequestContextModule = ClsModule.forRoot({
  global: true,
  middleware: {
    mount: true,
    generateId: true,
    idGenerator: (req: { id: string }) => req.id,
  },
});

/** The current request's id, or `undefined` outside a request (startup). */
export function currentRequestId(): string | undefined {
  const cls = ClsServiceManager.getClsService();
  return cls.isActive() ? cls.getId() : undefined;
}
