import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from '@/modules/users/user.entity';
import { Grant } from './grant.entity';
import { GrantAction } from './grant-action.entity';
import { Permission } from './permission.entity';
import { PermissionAction } from './permission-action.entity';
import { RbacBootstrapService } from './rbac-bootstrap.service';
import { RbacPolicyState } from './rbac-policy-state.entity';
import { Role } from './role.entity';
import { UserRole } from './user-role.entity';

@Module({
  imports: [
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
  providers: [RbacBootstrapService],
})
export class RbacModule {}
