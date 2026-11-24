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
import { GrantBodyDto, GrantResponse } from './dto/grant.dto';
import { RbacGrantsService } from './rbac-grants.service';
import { ActorUserId, RequirePermission } from './rbac.decorators';
import { RbacAdminAuditInterceptor } from './rbac-admin-audit.interceptor';
import { ApiRbacAdmin, ApiRbacWrite, ApiUuidParam } from './rbac-api-docs';
import { AuditTarget } from './rbac-audit.logger';

const BAD_ACTION =
  '`bad_request`: the body is invalid, or an action does not belong to the permission.';
const MANAGE_CONFLICT = 'no active user would keep `rbac@manage`';

/** Grant management. Every route needs `rbac@manage`. */
@Controller('admin/rbac/grants')
@RequirePermission('rbac', 'manage')
@AuditTarget('grant', 'grantId')
@UseInterceptors(RbacAdminAuditInterceptor)
@ApiRbacAdmin('RBAC grants')
export class RbacGrantsController {
  constructor(private readonly grantsService: RbacGrantsService) {}

  @Get()
  @ApiOperation({ summary: 'List all grants' })
  @ApiOkResponse({ type: [GrantResponse] })
  list(): Promise<GrantResponse[]> {
    return this.grantsService.list();
  }

  @Post()
  @ApiRbacWrite()
  @ApiOperation({
    summary: 'Grant a role a permission',
    description:
      'Missing or empty `actions` gives all current and future actions ' +
      '(`allActions: true`); otherwise only the listed ones.',
  })
  @ApiCreatedResponse({ type: GrantResponse })
  @ApiErrorResponse(400, BAD_ACTION)
  @ApiErrorResponse(404, '`not_found`: the role or permission does not exist.')
  @ApiErrorResponse(
    409,
    '`conflict`: the role already has a grant for this permission.',
  )
  create(
    @ActorUserId() actorUserId: string,
    @Body() dto: GrantBodyDto,
  ): Promise<GrantResponse> {
    return this.grantsService.create(actorUserId, dto);
  }

  @Put(':grantId')
  @ApiRbacWrite()
  @ApiOperation({
    summary: 'Replace a grant',
    description:
      'Full replacement of role, permission and actions. A missing ' +
      '`actions` means all actions, not "keep the current ones".',
  })
  @ApiUuidParam('grantId')
  @ApiOkResponse({ type: GrantResponse })
  @ApiErrorResponse(400, BAD_ACTION)
  @ApiErrorResponse(
    404,
    '`not_found`: the grant, role or permission does not exist.',
  )
  @ApiErrorResponse(
    409,
    `\`conflict\`: the new role/permission pair is taken, or ${MANAGE_CONFLICT}.`,
  )
  replace(
    @ActorUserId() actorUserId: string,
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @Body() dto: GrantBodyDto,
  ): Promise<GrantResponse> {
    return this.grantsService.replace(actorUserId, grantId, dto);
  }

  @Delete(':grantId')
  @ApiRbacWrite()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a grant' })
  @ApiUuidParam('grantId')
  @ApiNoContentResponse({ description: 'The grant was deleted.' })
  @ApiErrorResponse(400)
  @ApiErrorResponse(404, '`not_found`: the grant does not exist.')
  @ApiErrorResponse(409, `\`conflict\`: ${MANAGE_CONFLICT}.`)
  delete(
    @ActorUserId() actorUserId: string,
    @Param('grantId', ParseUUIDPipe) grantId: string,
  ): Promise<void> {
    return this.grantsService.delete(actorUserId, grantId);
  }
}
