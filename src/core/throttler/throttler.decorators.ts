import { ExecutionContext, SetMetadata } from '@nestjs/common';

export const REGISTRATION_THROTTLER = 'registration';

const REGISTRATION_THROTTLE_KEY = 'throttler:registration';

/**
 * Adds the stricter `registration` limit (THROTTLE_REGISTRATION_*) on top of
 * the global one. Each route has its own counter.
 */
export const RegistrationThrottle = () =>
  SetMetadata(REGISTRATION_THROTTLE_KEY, true);

export function isRegistrationThrottled(context: ExecutionContext): boolean {
  return (
    Reflect.getMetadata(REGISTRATION_THROTTLE_KEY, context.getHandler()) ===
    true
  );
}

export const LOGIN_THROTTLER = 'login';

const LOGIN_THROTTLE_KEY = 'throttler:login';

/**
 * Adds the `login` limit (THROTTLE_LOGIN_*, 30 per IP per minute) on top of
 * the global one. Counts every request, before the body is validated. Used by
 * `POST /auth/login` and `POST /auth/refresh`; each route has its own counter.
 */
export const LoginThrottle = () => SetMetadata(LOGIN_THROTTLE_KEY, true);

export function isLoginThrottled(context: ExecutionContext): boolean {
  return Reflect.getMetadata(LOGIN_THROTTLE_KEY, context.getHandler()) === true;
}
