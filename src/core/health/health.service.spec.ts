import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService } from '@nestjs/terminus';
import { HealthService } from './health.service';
import { RbacPolicyHealthIndicator } from '@/modules/rbac/rbac-policy.health';

describe('HealthService', () => {
  let service: HealthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: HealthCheckService, useValue: { check: jest.fn() } },
        {
          provide: RbacPolicyHealthIndicator,
          useValue: { isHealthy: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
