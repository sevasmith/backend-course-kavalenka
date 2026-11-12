import { Controller, Get, Post } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import { Public, RequirePermission } from './rbac.decorators';
import { RbacRouteScanner } from './rbac-route-scanner';

@Controller('good')
class GoodController {
  @Get()
  @Public()
  open() {}

  @Post()
  @RequirePermission('users', 'update')
  protected() {}

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

  it('stops the startup with the bad routes in the error', async () => {
    const scanner = await scannerFor([BadController]);

    expect(() => scanner.onModuleInit()).toThrow(
      /BadController\.forgotten: undeclared/,
    );
  });
});
