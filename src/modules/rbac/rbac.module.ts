import { Module } from '@nestjs/common';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from '@/modules/users/user.entity';
import { Grant } from './grant.entity';
import { GrantAction } from './grant-action.entity';
import { Permission } from './permission.entity';
import { PermissionAction } from './permission-action.entity';
import { RbacAuthorizationService } from './rbac-authorization.service';
import { RbacPolicyChangeService } from './rbac-policy-change.service';
import { RbacPolicyHealthIndicator } from './rbac-policy.health';
import { RbacBootstrapService } from './rbac-bootstrap.service';
import { RbacPolicySnapshotService } from './rbac-policy-snapshot.service';
import { RbacPolicyState } from './rbac-policy-state.entity';
import { RbacRolesController } from './rbac-roles.controller';
import { RbacRolesService } from './rbac-roles.service';
import { RbacRouteScanner } from './rbac-route-scanner';
import { RbacGuard } from './rbac.guard';
import { Role } from './role.entity';
import { UserRole } from './user-role.entity';

@Module({
  imports: [
    // Lets the route scanner list every controller at startup.
    DiscoveryModule,
    // Provides `HealthIndicatorService` for the readiness indicator.
    TerminusModule,
    TypeOrmModule.forFeature([
      Role,
      Permission,
      PermissionAction,
      Grant,
      GrantAction,
      UserRole,
      RbacPolicyState,
      // Read-only here: the bootstrap checks that the admin user exists.
      User,
    ]),
  ],
  controllers: [RbacRolesController],
  providers: [
    RbacBootstrapService,
    RbacPolicySnapshotService,
    RbacPolicyHealthIndicator,
    RbacAuthorizationService,
    RbacPolicyChangeService,
    RbacRolesService,
    RbacRouteScanner,
    // The central guard: runs for every route of the app.
    { provide: APP_GUARD, useClass: RbacGuard },
  ],
  exports: [
    RbacPolicySnapshotService,
    RbacPolicyHealthIndicator,
    RbacAuthorizationService,
  ],
})
export class RbacModule {}
