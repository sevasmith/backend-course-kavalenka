import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck } from '@nestjs/terminus';

import { HealthService } from './health.service';
import { ConfigService } from '@/core/config/config.service';
import { ApiRateLimitResponse } from '@/core/http/openapi';
import { Public } from '@/modules/rbac/rbac.decorators';

@Controller('health')
@ApiTags('Health')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  @Public()
  // Also documents the 200 and 503 bodies when `@nestjs/swagger` is installed.
  @HealthCheck()
  @ApiOperation({
    summary: 'Readiness check',
    description:
      '200 when ready; 503 until the RBAC policy snapshot is loaded. ' +
      'With `HEALTH_CHECK_ENABLED=false`, always 200 with no details.',
  })
  @ApiRateLimitResponse()
  async check() {
    const healthCheckEnabled = this.configService.get('HEALTH_CHECK_ENABLED');

    if (!healthCheckEnabled) {
      return this.healthService.getEmptyResponse();
    }

    return this.healthService.checkHealth();
  }
}
