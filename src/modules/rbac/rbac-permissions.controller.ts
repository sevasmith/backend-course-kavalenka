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
} from '@nestjs/common';

import { PermissionBodyDto, PermissionResponse } from './dto/permission.dto';
import { RbacPermissionsService } from './rbac-permissions.service';
import { RequirePermission } from './rbac.decorators';

/** Permission management. Every route needs `rbac@manage`. */
@Controller('admin/rbac/permissions')
@RequirePermission('rbac', 'manage')
export class RbacPermissionsController {
  constructor(private readonly permissionsService: RbacPermissionsService) {}

  @Get()
  list(): Promise<PermissionResponse[]> {
    return this.permissionsService.list();
  }

  /** 201 with the created permission; 409 if the name is taken. */
  @Post()
  create(@Body() dto: PermissionBodyDto): Promise<PermissionResponse> {
    return this.permissionsService.create(dto);
  }

  /**
   * 200 with the current permission; 404 if missing; 409 if the name is
   * taken or a removed action is part of an explicit grant.
   */
  @Put(':permissionId')
  replace(
    @Param('permissionId', ParseUUIDPipe) permissionId: string,
    @Body() dto: PermissionBodyDto,
  ): Promise<PermissionResponse> {
    return this.permissionsService.replace(permissionId, dto);
  }

  /** 204; 404 if missing, 409 if the permission has grants. */
  @Delete(':permissionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Param('permissionId', ParseUUIDPipe) permissionId: string,
  ): Promise<void> {
    return this.permissionsService.delete(permissionId);
  }
}
