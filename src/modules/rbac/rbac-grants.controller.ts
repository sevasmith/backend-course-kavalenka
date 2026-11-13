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

import { GrantBodyDto, GrantResponse } from './dto/grant.dto';
import { RbacGrantsService } from './rbac-grants.service';
import { RequirePermission } from './rbac.decorators';

/** Grant management. Every route needs `rbac@manage`. */
@Controller('admin/rbac/grants')
@RequirePermission('rbac', 'manage')
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
  create(@Body() dto: GrantBodyDto): Promise<GrantResponse> {
    return this.grantsService.create(dto);
  }

  /**
   * 200 with the current grant; 404 if the grant, role or permission is
   * missing; 400 for a foreign action; 409 if the new pair is taken or no
   * user would keep `rbac@manage`.
   */
  @Put(':grantId')
  replace(
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @Body() dto: GrantBodyDto,
  ): Promise<GrantResponse> {
    return this.grantsService.replace(grantId, dto);
  }

  /** 204; 404 if missing; 409 if no user would keep `rbac@manage`. */
  @Delete(':grantId')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('grantId', ParseUUIDPipe) grantId: string): Promise<void> {
    return this.grantsService.delete(grantId);
  }
}
