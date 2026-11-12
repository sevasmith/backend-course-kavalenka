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

import { RoleBodyDto, RoleResponse } from './dto/role.dto';
import { RbacRolesService } from './rbac-roles.service';
import { RequirePermission } from './rbac.decorators';

/**
 * Role management. Every route needs `rbac@manage` (declared on the class),
 * so the guard answers 401/403 before any lookup: a 404 is only possible
 * for an RBAC admin.
 */
@Controller('admin/rbac/roles')
@RequirePermission('rbac', 'manage')
export class RbacRolesController {
  constructor(private readonly rolesService: RbacRolesService) {}

  @Get()
  list(): Promise<RoleResponse[]> {
    return this.rolesService.list();
  }

  /** 201 with the created role; 409 if the name is taken. */
  @Post()
  create(@Body() dto: RoleBodyDto): Promise<RoleResponse> {
    return this.rolesService.create(dto);
  }

  /** 200 with the current role; 404 if missing, 409 if the name is taken. */
  @Put(':roleId')
  replace(
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: RoleBodyDto,
  ): Promise<RoleResponse> {
    return this.rolesService.replace(roleId, dto);
  }

  /** 204; 404 if missing, 409 if the role has grants or users. */
  @Delete(':roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('roleId', ParseUUIDPipe) roleId: string): Promise<void> {
    return this.rolesService.delete(roleId);
  }
}
