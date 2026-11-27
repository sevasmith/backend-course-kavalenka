import { MODULE_METADATA } from '@nestjs/common/constants';
import { APP_GUARD } from '@nestjs/core';

import { CsrfGuard } from '@/core/http/csrf.guard';
import { AccessCheckGuard } from '@/modules/auth/access-check.guard';
import { RbacGuard } from '@/modules/rbac/rbac.guard';
import { AppModule } from './app.module';

interface GuardProvider {
  provide: unknown;
  useClass?: unknown;
  useExisting?: unknown;
}

/**
 * Global guards run in the order they are registered. The chain order is a
 * security rule (1.3 §1.3.1): who is calling, then CSRF, then RBAC. Swapping
 * them would, for example, turn a missing cookie into a 403.
 */
describe('AppModule security chain', () => {
  it('registers the guards in the order access → CSRF → RBAC', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      AppModule,
    ) as GuardProvider[];

    const guards = providers
      .filter((provider) => provider.provide === APP_GUARD)
      .map((provider) => provider.useExisting ?? provider.useClass);

    expect(guards).toEqual([AccessCheckGuard, CsrfGuard, RbacGuard]);
  });
});
