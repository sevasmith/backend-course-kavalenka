import { Controller, Get, Logger, Post } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import { Public, ReceiptHeader, RequirePermission } from './rbac.decorators';
import { RbacRouteScanner } from './rbac-route-scanner';

@Controller('good')
class GoodController {
  @Get()
  @Public()
  open() {}

  @Post()
  @RequirePermission('users', 'update')
  protected() {}

  @Get('receipt')
  @ReceiptHeader('Deletion-Receipt')
  byReceipt() {}

  @Get('receipt-or-pair')
  @ReceiptHeader('Deletion-Receipt')
  @RequirePermission('users', 'delete')
  byReceiptOrPair() {}

  // Not a route: no decorator needed.
  helper() {}
}

@Controller('bad')
class BadController {
  @Get()
  forgotten() {}

  @Post()
  @Public()
  @RequirePermission('users', 'update')
  both() {}
}

@Controller('typo')
class TypoController {
  @Get()
  @RequirePermission('Users', 'read')
  read() {}

  @Post()
  @Public()
  @ReceiptHeader('Deletion-Receipt')
  publicAndReceipt() {}
}

@Public()
@Controller('public')
class PublicController {
  @Get()
  open() {}
}

async function scannerFor(controllers: (new () => object)[]) {
  const module = await Test.createTestingModule({
    imports: [DiscoveryModule],
    controllers,
    providers: [RbacRouteScanner],
  }).compile();
  return module.get(RbacRouteScanner);
}

describe('RbacRouteScanner', () => {
  afterEach(() => jest.restoreAllMocks());

  it('accepts routes that declare their access', async () => {
    const scanner = await scannerFor([GoodController, PublicController]);

    expect(scanner.findRoutesWithoutAccess()).toEqual([]);
    expect(() => scanner.onModuleInit()).not.toThrow();
  });

  it('names every route without a decorator or with both', async () => {
    const scanner = await scannerFor([GoodController, BadController]);

    expect(scanner.findRoutesWithoutAccess()).toEqual([
      'BadController.forgotten: undeclared',
      'BadController.both: ambiguous',
    ]);
  });

  it('names routes with a bad name or @Public() with a receipt', async () => {
    const scanner = await scannerFor([TypoController]);

    expect(scanner.findRoutesWithoutAccess()).toEqual([
      'TypoController.read: invalid, bad permission name "Users"',
      'TypoController.publicAndReceipt: ambiguous',
    ]);
  });

  it('stops the startup with the bad routes in the error', async () => {
    const scanner = await scannerFor([BadController]);
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    expect(() => scanner.onModuleInit()).toThrow(
      /BadController\.forgotten: undeclared/,
    );
  });

  it('logs every bad route on its own line before stopping', async () => {
    const scanner = await scannerFor([BadController, TypoController]);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    expect(() => scanner.onModuleInit()).toThrow();
    expect(error.mock.calls.map(([line]) => line as string)).toEqual([
      'rbac.route.invalid operation=BadController.forgotten kind=undeclared',
      'rbac.route.invalid operation=BadController.both kind=ambiguous',
      'rbac.route.invalid operation=TypoController.read kind=invalid problem="bad permission name \\"Users\\""',
      'rbac.route.invalid operation=TypoController.publicAndReceipt kind=ambiguous',
    ]);
  });
});
