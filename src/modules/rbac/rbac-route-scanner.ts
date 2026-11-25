import { Injectable, OnModuleInit, Type } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';

import { getRouteAccess } from './rbac.decorators';

/**
 * Checks at startup that every route declares its access: `@Public()`,
 * `@RequirePermission()`, `@ReceiptHeader()` or a receipt with a pair; not
 * none, not `@Public()` mixed with the others, and only names in the RBAC
 * format (`getRouteAccess` decides all this). Otherwise it throws, which
 * stops the app with the list of bad routes, so a forgotten decorator fails
 * in dev or CI instead of being found in production (see the plan Notes).
 */
@Injectable()
export class RbacRouteScanner implements OnModuleInit {
  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    const problems = this.findRoutesWithoutAccess();
    if (problems.length > 0) {
      throw new Error(
        'Every route needs exactly one of: @Public(), @RequirePermission(), ' +
          '@ReceiptHeader(), or @ReceiptHeader() with @RequirePermission(); ' +
          'names must match the RBAC format. ' +
          `Fix these routes:\n${problems.join('\n')}`,
      );
    }
  }

  /** `"Controller.method: undeclared"` for every misconfigured route. */
  findRoutesWithoutAccess(): string[] {
    const problems: string[] = [];

    for (const wrapper of this.discoveryService.getControllers()) {
      const controller = wrapper.metatype as Type | null;
      if (!controller) {
        continue;
      }

      const prototype = controller.prototype as Record<
        string,
        (...args: unknown[]) => unknown
      >;
      for (const methodName of this.metadataScanner.getAllMethodNames(
        prototype,
      )) {
        const handler = prototype[methodName];
        // Only route handlers (`@Get()`, `@Post()`, ...) have an HTTP method.
        if (this.reflector.get(METHOD_METADATA, handler) === undefined) {
          continue;
        }

        const access = getRouteAccess(this.reflector, handler, controller);
        const route = `${controller.name}.${methodName}`;
        if (access.kind === 'undeclared' || access.kind === 'ambiguous') {
          problems.push(`${route}: ${access.kind}`);
        }
        if (access.kind === 'invalid') {
          problems.push(`${route}: invalid, ${access.problem}`);
        }
      }
    }

    return problems;
  }
}
