import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';

import { ApiErrorResponse } from '@/core/http/openapi';
import { RoleBodyDto, RoleResponse } from './dto/role.dto';
import { RbacRolesService } from './rbac-roles.service';
import { ActorUserId, RequirePermission } from './rbac.decorators';
import { RbacAdminAuditInterceptor } from './rbac-admin-audit.interceptor';
import { ApiRbacAdmin, ApiRbacWrite, ApiUuidParam } from './rbac-api-docs';
import { AuditTarget } from './rbac-audit.logger';

/**
 * Role management. Every route needs `rbac@manage` (declared on the class),
 * so the guard answers 401/403 before any lookup: a 404 is only possible
 * for an RBAC admin.
 */
@Controller('admin/rbac/roles')
@RequirePermission('rbac', 'manage')
@AuditTarget('role', 'roleId')
@UseInterceptors(RbacAdminAuditInterceptor)
@ApiRbacAdmin('RBAC roles')
export class RbacRolesController {
  constructor(private readonly rolesService: RbacRolesService) {}

  @Get()
  @ApiOperation({ summary: 'List all roles, sorted by name' })
  @ApiOkResponse({ type: [RoleResponse] })
  list(): Promise<RoleResponse[]> {
    return this.rolesService.list();
  }

  @Post()
  @ApiRbacWrite()
  @ApiOperation({ summary: 'Create a role' })
  @ApiCreatedResponse({ type: RoleResponse })
  @ApiErrorResponse(400)
  @ApiErrorResponse(409, '`conflict`: the name is already taken.')
  create(
    @ActorUserId() actorUserId: string,
    @Body() dto: RoleBodyDto,
  ): Promise<RoleResponse> {
    return this.rolesService.create(actorUserId, dto);
  }

  @Put(':roleId')
  @ApiRbacWrite()
  @ApiOperation({
    summary: 'Replace a role',
    description: 'Full replacement: a missing `description` clears it.',
  })
  @ApiUuidParam('roleId')
  @ApiOkResponse({ type: RoleResponse })
  @ApiErrorResponse(400)
  @ApiErrorResponse(404, '`not_found`: the role does not exist.')
  @ApiErrorResponse(409, '`conflict`: the name is already taken.')
  replace(
    @ActorUserId() actorUserId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: RoleBodyDto,
  ): Promise<RoleResponse> {
    return this.rolesService.replace(actorUserId, roleId, dto);
  }

  @Delete(':roleId')
  @ApiRbacWrite()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an unused role' })
  @ApiUuidParam('roleId')
  @ApiNoContentResponse({ description: 'The role was deleted.' })
  @ApiErrorResponse(400)
  @ApiErrorResponse(404, '`not_found`: the role does not exist.')
  @ApiErrorResponse(
    409,
    '`conflict`: the role has grants or is assigned to users.',
  )
  delete(
    @ActorUserId() actorUserId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ): Promise<void> {
    return this.rolesService.delete(actorUserId, roleId);
  }
}
