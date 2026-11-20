import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';

import { RbacPolicySnapshotService } from './rbac-policy-snapshot.service';

/**
 * Readiness check for RBAC: the app is ready only while a current policy
 * snapshot is available, because without it every protected route gets 503.
 *
 * It asks for the current snapshot instead of only checking `isLoaded()`.
 * That costs one small version query per probe, but it also retries a failed
 * load, so readiness recovers on its own even when no requests come in. It
 * also reports "down" when the version can't be read, which is exactly when
 * protected routes would fail.
 */
@Injectable()
export class RbacPolicyHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly snapshotService: RbacPolicySnapshotService,
  ) {}

  async isHealthy(key = 'rbac') {
    const indicator = this.healthIndicatorService.check(key);

    try {
      await this.snapshotService.getCurrentSnapshot();
      return indicator.up();
    } catch {
      // The reason is already logged by the snapshot service. The endpoint is
      // public, so the response says nothing about the policy itself.
      return indicator.down({ message: 'RBAC policy is unavailable' });
    }
  }
}
