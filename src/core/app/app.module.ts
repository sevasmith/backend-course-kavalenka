import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { ConfigModule } from '@/core/config/config.module';
import { DatabaseModule } from '@/core/database/database.module';
import { HealthModule } from '@/core/health/health.module';
import { AllExceptionsFilter } from '@/core/http/all-exceptions.filter';
import { ThrottlerModule } from '@/core/throttler/throttler.module';

/**
 *
 * Application modules
 *
 */
import { UsersModule } from '@/modules/users/users.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { RbacModule } from '@/modules/rbac/rbac.module';
import { AccessCheckGuard } from '@/modules/auth/access-check.guard';
import { RbacGuard } from '@/modules/rbac/rbac.guard';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    HealthModule,
    ThrottlerModule,
    AuthModule,
    UsersModule,
    RbacModule,
  ],
  providers: [
    // Registered here, not in `main.ts`, so e2e tests built from `AppModule`
    // get the same error responses.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    /**
     * The security chain. Global guards run in the order they are
     * registered, and both are listed here, in one module, so the order is
     * explicit and doesn't depend on module import order:
     * 1. who is calling (the access cookie and an `active` user);
     * 2. what they may do (RBAC).
     * `useExisting` reuses the instance each module provides with its own
     * dependencies.
     */
    { provide: APP_GUARD, useExisting: AccessCheckGuard },
    { provide: APP_GUARD, useExisting: RbacGuard },
  ],
})
export class AppModule {}
