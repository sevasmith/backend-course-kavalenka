import { Injectable } from '@nestjs/common';
import { HealthCheckService, HealthCheckResult } from '@nestjs/terminus';

import { RbacPolicyHealthIndicator } from '@/modules/rbac/rbac-policy.health';

@Injectable()
export class HealthService {
  constructor(
    private readonly healthCheckService: HealthCheckService,
    private readonly rbacPolicy: RbacPolicyHealthIndicator,
  ) {}

  getEmptyResponse(): HealthCheckResult {
    return {
      status: 'ok',
      details: {},
    };
  }

  checkHealth() {
    return this.healthCheckService.check([
      // Not ready until the RBAC policy snapshot is loaded (503 otherwise).
      () => this.rbacPolicy.isHealthy(),
    ]);
  }
}
