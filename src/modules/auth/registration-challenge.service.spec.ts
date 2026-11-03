import { createHmac } from 'node:crypto';

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ConfigService } from '@/core/config/config.service';
import { RegistrationChallenge } from './registration-challenge.entity';
import { RegistrationChallengeService } from './registration-challenge.service';
import { RegistrationChallengeMethod } from './registration-challenge.types';

describe('RegistrationChallengeService', () => {
  const hmacKey = 'k'.repeat(32);
  const hmac = (secret: string) =>
    createHmac('sha256', hmacKey).update(secret).digest('hex');

  let service: RegistrationChallengeService;
  let repository: { create: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    repository = {
      create: jest.fn((input: unknown) => input),
      save: jest.fn((input: object) =>
        Promise.resolve({ id: 'attempt-id', ...input }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegistrationChallengeService,
        {
          provide: getRepositoryToken(RegistrationChallenge),
          useValue: repository,
        },
        { provide: ConfigService, useValue: { get: () => hmacKey } },
      ],
    }).compile();

    service = module.get(RegistrationChallengeService);
  });

  it('creates a 6-digit OTP and stores only its HMAC', async () => {
    const { challenge, secret } = await service.create(
      'user-id',
      RegistrationChallengeMethod.OTP,
    );

    expect(secret).toMatch(/^\d{6}$/);
    expect(challenge.secretHash).toBe(hmac(secret));
    expect(challenge.secretHash).not.toContain(secret);
  });

  it('creates a 32-byte base64url magic link token', async () => {
    const { challenge, secret } = await service.create(
      'user-id',
      RegistrationChallengeMethod.MAGIC_LINK,
    );

    expect(Buffer.from(secret, 'base64url')).toHaveLength(32);
    expect(challenge.secretHash).toBe(hmac(secret));
  });

  it('expires 10 minutes after it is sent', async () => {
    const { challenge } = await service.create(
      'user-id',
      RegistrationChallengeMethod.OTP,
    );

    expect(challenge.expiresAt.getTime() - challenge.lastSentAt.getTime()).toBe(
      600_000,
    );
  });
});
