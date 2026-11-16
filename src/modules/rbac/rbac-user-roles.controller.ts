import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  UseInterceptors,
} from '@nestjs/common';

import { UserRolesBodyDto, UserRolesResponse } from './dto/user-roles.dto';
import { RbacUserRolesService } from './rbac-user-roles.service';
import { ActorUserId, RequirePermission } from './rbac.decorators';
import { RbacAdminAuditInterceptor } from './rbac-admin-audit.interceptor';
import { AuditTarget } from './rbac-audit.logger';

/** A user's roles. Every route needs `rbac@manage`. */
@Controller('admin/rbac/users/:userId/roles')
@RequirePermission('rbac', 'manage')
@AuditTarget('user_roles', 'userId')
@UseInterceptors(RbacAdminAuditInterceptor)
export class RbacUserRolesController {
  constructor(private readonly userRolesService: RbacUserRolesService) {}

  /** 200 with `userId` and `roleIds`; 404 if the user doesn't exist. */
  @Get()
  get(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<UserRolesResponse> {
    return this.userRolesService.get(userId);
  }

  /**
   * 200 with the new `roleIds`; 404 if the user or a role is missing;
   * 409 if no active user would keep `rbac@manage`.
   */
  @Put()
  replace(
    @ActorUserId() actorUserId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UserRolesBodyDto,
  ): Promise<UserRolesResponse> {
    return this.userRolesService.replace(actorUserId, userId, dto);
  }
}
