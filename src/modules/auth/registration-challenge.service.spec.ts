import { createHmac, timingSafeEqual } from 'node:crypto';

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ConfigService } from '@/core/config/config.service';
import { RegistrationChallenge } from './registration-challenge.entity';
import { RegistrationChallengeService } from './registration-challenge.service';
import {
  RegistrationChallengeConsumedReason,
  RegistrationChallengeMethod,
} from './registration-challenge.types';

// Wraps the real function so a test can check that it is used.
jest.mock('node:crypto', () => {
  const actual =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { ...actual, timingSafeEqual: jest.fn(actual.timingSafeEqual) };
});

describe('RegistrationChallengeService', () => {
  const hmacKey = 'k'.repeat(32);
  const hmac = (secret: string) =>
    createHmac('sha256', hmacKey).update(secret).digest('hex');

  let service: RegistrationChallengeService;
  let repository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };

  beforeEach(async () => {
    repository = {
      create: jest.fn((input: unknown) => input),
      save: jest.fn((input: object) =>
        Promise.resolve({ id: 'attempt-id', ...input }),
      ),
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(undefined),
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

  it('finds an OTP attempt by id, only among OTP attempts, and locks the row', async () => {
    await service.findOtpAttemptForUpdate('attempt-id');

    expect(repository.findOne).toHaveBeenCalledWith({
      where: { id: 'attempt-id', method: RegistrationChallengeMethod.OTP },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('finds a magic link attempt by the HMAC of the token, not the token, and locks the row', async () => {
    await service.findMagicLinkAttemptForUpdate('token');

    expect(repository.findOne).toHaveBeenCalledWith({
      where: {
        secretHash: hmac('token'),
        method: RegistrationChallengeMethod.MAGIC_LINK,
      },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('finds the newest attempt of a user, in any state, and locks the row', async () => {
    await service.findLatestForUserForUpdate('user-id');

    expect(repository.findOne).toHaveBeenCalledWith({
      where: { userId: 'user-id' },
      order: { lastSentAt: 'DESC' },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('returns null when nothing matches', async () => {
    await expect(
      service.findMagicLinkAttemptForUpdate('token'),
    ).resolves.toBeNull();
  });

  describe('secretMatches', () => {
    const challenge = { secretHash: hmac('123456') } as RegistrationChallenge;

    it('accepts the secret whose HMAC is stored', () => {
      expect(service.secretMatches(challenge, '123456')).toBe(true);
    });

    it('rejects another secret', () => {
      expect(service.secretMatches(challenge, '654321')).toBe(false);
    });

    it('rejects instead of throwing when the stored hash has another length', () => {
      const broken = { secretHash: 'abcd' } as RegistrationChallenge;

      expect(service.secretMatches(broken, '123456')).toBe(false);
    });

    it('compares in constant time with crypto.timingSafeEqual', () => {
      jest.mocked(timingSafeEqual).mockClear();

      service.secretMatches(challenge, '654321');

      expect(timingSafeEqual).toHaveBeenCalledTimes(1);
    });
  });

  describe('registerWrongSecret', () => {
    const challenge = (attempts: number) =>
      ({ id: 'attempt-id', attempts }) as RegistrationChallenge;

    it('increments the counter and keeps the attempt active', async () => {
      const result = await service.registerWrongSecret(challenge(0));

      expect(repository.update).toHaveBeenCalledWith('attempt-id', {
        attempts: 1,
        consumedAt: null,
        consumedReason: null,
      });
      expect(result.attempts).toBe(1);
    });

    it('consumes the attempt with attempts_exhausted on the fifth wrong entry', async () => {
      const result = await service.registerWrongSecret(challenge(4));

      expect(repository.update).toHaveBeenCalledWith('attempt-id', {
        attempts: 5,
        consumedAt: expect.any(Date) as Date,
        consumedReason: RegistrationChallengeConsumedReason.ATTEMPTS_EXHAUSTED,
      });
      expect(result.consumedReason).toBe(
        RegistrationChallengeConsumedReason.ATTEMPTS_EXHAUSTED,
      );
    });
  });

  it('consumes an attempt with the given reason', async () => {
    await service.consume(
      { id: 'attempt-id' } as RegistrationChallenge,
      RegistrationChallengeConsumedReason.CONFIRMED,
    );

    expect(repository.update).toHaveBeenCalledWith('attempt-id', {
      consumedAt: expect.any(Date) as Date,
      consumedReason: RegistrationChallengeConsumedReason.CONFIRMED,
    });
  });
});
