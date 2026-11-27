import { Injectable, Logger, OnModuleInit, Type } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';

import { getRouteAccess } from './rbac.decorators';
import { formatAuditEvent } from './rbac-audit.logger';

/** One route without a valid access declaration. */
export interface BadRoute {
  /** `Controller.method`, the same operation name the guards log. */
  operation: string;
  kind: 'undeclared' | 'ambiguous' | 'invalid';
  /** Only for `invalid`: which name is wrong. */
  problem?: string;
}

/**
 * Checks at startup that every route declares its access: `@Public()`,
 * `@RequirePermission()`, `@ReceiptHeader()` or a receipt with a pair; not
 * none, not `@Public()` mixed with the others, and only names in the RBAC
 * format (`getRouteAccess` decides all this). Otherwise it throws, which
 * stops the app with the list of bad routes, so a forgotten decorator fails
 * in dev or CI instead of being found in production (see the plan Notes).
 *
 * Each bad route is also logged on its own line (1.3 §1.5 "an operation
 * without a valid declaration detected at startup"), so log monitoring
 * sees it, not only whoever reads the crash message.
 */
@Injectable()
export class RbacRouteScanner implements OnModuleInit {
  private readonly logger = new Logger(RbacRouteScanner.name);

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    const badRoutes = this.findBadRoutes();
    for (const route of badRoutes) {
      this.logger.error(
        formatAuditEvent('rbac.route.invalid', {
          operation: route.operation,
          kind: route.kind,
          // Set by our own decorators; quoted, since it has spaces.
          problem: route.problem && JSON.stringify(route.problem),
        }),
      );
    }

    const problems = badRoutes.map(describeBadRoute);
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
    return this.findBadRoutes().map(describeBadRoute);
  }

  /** Every route of every controller whose declaration isn't valid. */
  findBadRoutes(): BadRoute[] {
    const badRoutes: BadRoute[] = [];

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
        const operation = `${controller.name}.${methodName}`;
        if (access.kind === 'undeclared' || access.kind === 'ambiguous') {
          badRoutes.push({ operation, kind: access.kind });
        }
        if (access.kind === 'invalid') {
          badRoutes.push({
            operation,
            kind: 'invalid',
            problem: access.problem,
          });
        }
      }
    }

    return badRoutes;
  }
}

function describeBadRoute(route: BadRoute): string {
  const problem = route.problem ? `, ${route.problem}` : '';
  return `${route.operation}: ${route.kind}${problem}`;
}
