import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { RbacModule } from '@/modules/rbac/rbac.module';

@Module({
  imports: [TerminusModule, RbacModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
