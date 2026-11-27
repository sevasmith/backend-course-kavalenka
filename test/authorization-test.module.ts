import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { apiError, ErrorCode } from '../src/core/http/api-error';
import {
  ActorUserId,
  ReceiptHeader,
  RequirePermission,
} from '../src/modules/rbac/rbac.decorators';
import { RbacModule } from '../src/modules/rbac/rbac.module';
import { RbacOwnershipService } from '../src/modules/rbac/rbac-ownership.service';

/**
 * Test-only routes for the parts of 1.3 that no real endpoint uses yet:
 * ownership (1.4 will) and receipts (1.6 will). Never part of the app:
 * only `authorization.e2e-spec.ts` adds this module.
 */
@Controller('e2e-authz')
class AuthorizationTestController {
  constructor(
    private readonly ownership: RbacOwnershipService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * The order from 1.3 for users: base pair (guard) → own or `*_any` → look
   * up → 404. Without `read_any`, a made-up id gets the same 403 as a real
   * one, so the answer never says whether the user exists.
   */
  @Get('users/:id')
  @RequirePermission('users', 'read')
  async readUser(
    @ActorUserId() actorUserId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    await this.ownership.assertOwnerOrAny({
      actorUserId,
      ownerId: id,
      permission: 'users',
      anyAction: 'read_any',
      operation: 'AuthorizationTestController.readUser',
    });
    const rows: { id: string }[] = await this.dataSource.query(
      'SELECT id FROM users WHERE id = $1',
      [id],
    );
    if (rows.length === 0) {
      throw new NotFoundException(
        apiError(ErrorCode.NOT_FOUND, 'User not found'),
      );
    }
    return { id: rows[0].id };
  }

  /** Receipt only. A real handler would check the receipt here. */
  @Delete('receipt')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ReceiptHeader('Deletion-Receipt')
  byReceipt(): void {}

  /** Receipt, or the usual chain with `users@delete` without the header. */
  @Delete('receipt-or-pair')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ReceiptHeader('Deletion-Receipt')
  @RequirePermission('users', 'delete')
  byReceiptOrPair(): void {}
}

@Module({
  imports: [RbacModule],
  controllers: [AuthorizationTestController],
})
export class AuthorizationTestModule {}
