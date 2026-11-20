import { Injectable, OnModuleInit, Type } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';

import { getRouteAccess } from './rbac.decorators';

/**
 * Checks at startup that every route declares its access: `@Public()` or
 * `@RequirePermission()`, not none and not both. Otherwise it throws, which
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
        'Every route needs @Public() or @RequirePermission(), not none and ' +
          `not both. Fix these routes:\n${problems.join('\n')}`,
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
        if (access.kind === 'undeclared' || access.kind === 'ambiguous') {
          problems.push(`${controller.name}.${methodName}: ${access.kind}`);
        }
      }
    }

    return problems;
  }
}
