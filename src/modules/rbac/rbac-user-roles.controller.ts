import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';

import { UserRolesBodyDto, UserRolesResponse } from './dto/user-roles.dto';
import { RbacUserRolesService } from './rbac-user-roles.service';
import { RequirePermission } from './rbac.decorators';

/** A user's roles. Every route needs `rbac@manage`. */
@Controller('admin/rbac/users/:userId/roles')
@RequirePermission('rbac', 'manage')
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
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UserRolesBodyDto,
  ): Promise<UserRolesResponse> {
    return this.userRolesService.replace(userId, dto);
  }
}
