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
