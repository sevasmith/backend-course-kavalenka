import { HealthIndicatorService } from '@nestjs/terminus';
import { Test, TestingModule } from '@nestjs/testing';

import { RbacPolicyHealthIndicator } from './rbac-policy.health';
import {
  RbacPolicySnapshotService,
  RbacPolicyUnavailableError,
} from './rbac-policy-snapshot.service';

describe('RbacPolicyHealthIndicator', () => {
  let indicator: RbacPolicyHealthIndicator;
  let getCurrentSnapshot: jest.Mock;

  beforeEach(async () => {
    getCurrentSnapshot = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacPolicyHealthIndicator,
        HealthIndicatorService,
        {
          provide: RbacPolicySnapshotService,
          useValue: { getCurrentSnapshot },
        },
      ],
    }).compile();

    indicator = module.get(RbacPolicyHealthIndicator);
  });

  it('is up when the policy snapshot is available', async () => {
    getCurrentSnapshot.mockResolvedValue({ version: 1 });

    await expect(indicator.isHealthy()).resolves.toEqual({
      rbac: { status: 'up' },
    });
  });

  it('is down when the policy snapshot is unavailable', async () => {
    getCurrentSnapshot.mockRejectedValue(new RbacPolicyUnavailableError());

    await expect(indicator.isHealthy()).resolves.toEqual({
      rbac: { status: 'down', message: 'RBAC policy is unavailable' },
    });
  });

  it('becomes up again once the policy loads', async () => {
    getCurrentSnapshot
      .mockRejectedValueOnce(new RbacPolicyUnavailableError())
      .mockResolvedValueOnce({ version: 1 });

    await expect(indicator.isHealthy()).resolves.toMatchObject({
      rbac: { status: 'down' },
    });
    await expect(indicator.isHealthy()).resolves.toEqual({
      rbac: { status: 'up' },
    });
  });
});
