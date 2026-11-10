import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from '@/modules/users/user.entity';
import { Grant } from './grant.entity';
import { GrantAction } from './grant-action.entity';
import { Permission } from './permission.entity';
import { PermissionAction } from './permission-action.entity';
import { RbacAuthorizationService } from './rbac-authorization.service';
import { RbacPolicyHealthIndicator } from './rbac-policy.health';
import { RbacBootstrapService } from './rbac-bootstrap.service';
import { RbacPolicySnapshotService } from './rbac-policy-snapshot.service';
import { RbacPolicyState } from './rbac-policy-state.entity';
import { Role } from './role.entity';
import { UserRole } from './user-role.entity';

@Module({
  imports: [
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
  providers: [
    RbacBootstrapService,
    RbacPolicySnapshotService,
    RbacPolicyHealthIndicator,
    RbacAuthorizationService,
  ],
  exports: [
    RbacPolicySnapshotService,
    RbacPolicyHealthIndicator,
    RbacAuthorizationService,
  ],
})
export class RbacModule {}
