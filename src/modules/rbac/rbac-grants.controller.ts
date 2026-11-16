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

import { GrantBodyDto, GrantResponse } from './dto/grant.dto';
import { RbacGrantsService } from './rbac-grants.service';
import { ActorUserId, RequirePermission } from './rbac.decorators';
import { RbacAdminAuditInterceptor } from './rbac-admin-audit.interceptor';
import { AuditTarget } from './rbac-audit.logger';

/** Grant management. Every route needs `rbac@manage`. */
@Controller('admin/rbac/grants')
@RequirePermission('rbac', 'manage')
@AuditTarget('grant', 'grantId')
@UseInterceptors(RbacAdminAuditInterceptor)
export class RbacGrantsController {
  constructor(private readonly grantsService: RbacGrantsService) {}

  @Get()
  list(): Promise<GrantResponse[]> {
    return this.grantsService.list();
  }

  /**
   * 201 with the created grant; 404 if the role or permission is missing;
   * 400 if an action doesn't belong to the permission; 409 if the pair is
   * already granted.
   */
  @Post()
  create(
    @ActorUserId() actorUserId: string,
    @Body() dto: GrantBodyDto,
  ): Promise<GrantResponse> {
    return this.grantsService.create(actorUserId, dto);
  }

  /**
   * 200 with the current grant; 404 if the grant, role or permission is
   * missing; 400 for a foreign action; 409 if the new pair is taken or no
   * user would keep `rbac@manage`.
   */
  @Put(':grantId')
  replace(
    @ActorUserId() actorUserId: string,
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @Body() dto: GrantBodyDto,
  ): Promise<GrantResponse> {
    return this.grantsService.replace(actorUserId, grantId, dto);
  }

  /** 204; 404 if missing; 409 if no user would keep `rbac@manage`. */
  @Delete(':grantId')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @ActorUserId() actorUserId: string,
    @Param('grantId', ParseUUIDPipe) grantId: string,
  ): Promise<void> {
    return this.grantsService.delete(actorUserId, grantId);
  }
}
