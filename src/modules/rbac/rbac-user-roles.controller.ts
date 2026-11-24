import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';

import { ApiErrorResponse } from '@/core/http/openapi';
import { UserRolesBodyDto, UserRolesResponse } from './dto/user-roles.dto';
import { RbacUserRolesService } from './rbac-user-roles.service';
import { ActorUserId, RequirePermission } from './rbac.decorators';
import { RbacAdminAuditInterceptor } from './rbac-admin-audit.interceptor';
import { ApiRbacAdmin, ApiRbacWrite, ApiUuidParam } from './rbac-api-docs';
import { AuditTarget } from './rbac-audit.logger';

/** A user's roles. Every route needs `rbac@manage`. */
@Controller('admin/rbac/users/:userId/roles')
@RequirePermission('rbac', 'manage')
@AuditTarget('user_roles', 'userId')
@UseInterceptors(RbacAdminAuditInterceptor)
@ApiRbacAdmin('RBAC user roles')
@ApiUuidParam('userId')
export class RbacUserRolesController {
  constructor(private readonly userRolesService: RbacUserRolesService) {}

  @Get()
  @ApiOperation({ summary: "Get a user's role ids" })
  @ApiOkResponse({ type: UserRolesResponse })
  @ApiErrorResponse(400)
  @ApiErrorResponse(404, '`not_found`: the user does not exist.')
  get(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<UserRolesResponse> {
    return this.userRolesService.get(userId);
  }

  @Put()
  @ApiRbacWrite()
  @ApiOperation({
    summary: "Replace a user's roles",
    description: 'Full replacement: `roleIds` is the complete new set.',
  })
  @ApiOkResponse({ type: UserRolesResponse })
  @ApiErrorResponse(400)
  @ApiErrorResponse(404, '`not_found`: the user or a role does not exist.')
  @ApiErrorResponse(409, '`conflict`: no active user would keep `rbac@manage`.')
  replace(
    @ActorUserId() actorUserId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UserRolesBodyDto,
  ): Promise<UserRolesResponse> {
    return this.userRolesService.replace(actorUserId, userId, dto);
  }
}
