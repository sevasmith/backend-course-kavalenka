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
import { PermissionBodyDto, PermissionResponse } from './dto/permission.dto';
import { RbacPermissionsService } from './rbac-permissions.service';
import { ActorUserId, RequirePermission } from './rbac.decorators';
import { RbacAdminAuditInterceptor } from './rbac-admin-audit.interceptor';
import { ApiRbacAdmin, ApiRbacWrite, ApiUuidParam } from './rbac-api-docs';
import { AuditTarget } from './rbac-audit.logger';

const MANAGE_CONFLICT = 'no active user would keep `rbac@manage`';

/** Permission management. Every route needs `rbac@manage`. */
@Controller('admin/rbac/permissions')
@RequirePermission('rbac', 'manage')
@AuditTarget('permission', 'permissionId')
@UseInterceptors(RbacAdminAuditInterceptor)
@ApiRbacAdmin('RBAC permissions')
export class RbacPermissionsController {
  constructor(private readonly permissionsService: RbacPermissionsService) {}

  @Get()
  @ApiOperation({ summary: 'List all permissions with their actions' })
  @ApiOkResponse({ type: [PermissionResponse] })
  list(): Promise<PermissionResponse[]> {
    return this.permissionsService.list();
  }

  @Post()
  @ApiRbacWrite()
  @ApiOperation({ summary: 'Create a permission with its actions' })
  @ApiCreatedResponse({ type: PermissionResponse })
  @ApiErrorResponse(400)
  @ApiErrorResponse(409, '`conflict`: the name is already taken.')
  create(
    @ActorUserId() actorUserId: string,
    @Body() dto: PermissionBodyDto,
  ): Promise<PermissionResponse> {
    return this.permissionsService.create(actorUserId, dto);
  }

  @Put(':permissionId')
  @ApiRbacWrite()
  @ApiOperation({
    summary: 'Replace a permission and its action set',
    description:
      'Full replacement. Kept actions keep their id, so explicit grants on ' +
      'them stay valid. Removing an action listed in an explicit grant is ' +
      "a 409; grants with all actions don't block it.",
  })
  @ApiUuidParam('permissionId')
  @ApiOkResponse({ type: PermissionResponse })
  @ApiErrorResponse(400)
  @ApiErrorResponse(404, '`not_found`: the permission does not exist.')
  @ApiErrorResponse(
    409,
    '`conflict`: the name is taken, a removed action is part of an ' +
      `explicit grant, or ${MANAGE_CONFLICT}.`,
  )
  replace(
    @ActorUserId() actorUserId: string,
    @Param('permissionId', ParseUUIDPipe) permissionId: string,
    @Body() dto: PermissionBodyDto,
  ): Promise<PermissionResponse> {
    return this.permissionsService.replace(actorUserId, permissionId, dto);
  }

  @Delete(':permissionId')
  @ApiRbacWrite()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a permission without grants' })
  @ApiUuidParam('permissionId')
  @ApiNoContentResponse({ description: 'The permission was deleted.' })
  @ApiErrorResponse(400)
  @ApiErrorResponse(404, '`not_found`: the permission does not exist.')
  @ApiErrorResponse(409, '`conflict`: the permission has grants.')
  delete(
    @ActorUserId() actorUserId: string,
    @Param('permissionId', ParseUUIDPipe) permissionId: string,
  ): Promise<void> {
    return this.permissionsService.delete(actorUserId, permissionId);
  }
}
