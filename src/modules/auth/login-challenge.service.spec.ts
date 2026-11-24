import { createHmac, timingSafeEqual } from 'node:crypto';

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';

import { ConfigService } from '@/core/config/config.service';
import { LoginChallenge } from './login-challenge.entity';
import { LoginChallengeService } from './login-challenge.service';
import {
  LoginChallengeConsumedReason,
  LoginChallengeMethod,
} from './login-challenge.types';

// Wraps the real function so a test can check that it is used.
jest.mock('node:crypto', () => {
  const actual =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { ...actual, timingSafeEqual: jest.fn(actual.timingSafeEqual) };
});

describe('LoginChallengeService', () => {
  const hmacKey = 'l'.repeat(32);
  const hmac = (secret: string) =>
    createHmac('sha256', hmacKey).update(secret).digest('hex');
  const attemptId = '3f1c2b9e-8d4a-4c6b-9e1f-2a7d5c8b0e41';

  let service: LoginChallengeService;
  let configGet: jest.Mock;
  let repository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };

  const challengeWith = (fields: Partial<LoginChallenge>): LoginChallenge =>
    ({ id: attemptId, ...fields }) as LoginChallenge;

  beforeEach(async () => {
    configGet = jest.fn(() => hmacKey);
    repository = {
      create: jest.fn((input: unknown) => input),
      save: jest.fn((input: object) =>
        Promise.resolve({ id: attemptId, ...input }),
      ),
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoginChallengeService,
        { provide: getRepositoryToken(LoginChallenge), useValue: repository },
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();

    service = module.get(LoginChallengeService);
  });

  describe('generateSecret', () => {
    it('creates a 6-digit OTP, keeping leading zeros', () => {
      for (let i = 0; i < 50; i++) {
        expect(service.generateSecret(LoginChallengeMethod.OTP)).toMatch(
          /^\d{6}$/,
        );
      }
    });

    it('creates a magic link secret of 32 bytes in base64url', () => {
      const secret = service.generateSecret(LoginChallengeMethod.MAGIC_LINK);

      expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(secret, 'base64url')).toHaveLength(32);
    });

    it('does not repeat magic link secrets', () => {
      const a = service.generateSecret(LoginChallengeMethod.MAGIC_LINK);
      const b = service.generateSecret(LoginChallengeMethod.MAGIC_LINK);
      expect(a).not.toBe(b);
    });
  });

  describe('hashSecret and secretMatches', () => {
    it('hashes with HMAC-SHA256 and LOGIN_CHALLENGE_HMAC_KEY', () => {
      expect(service.hashSecret('123456')).toBe(hmac('123456'));
      expect(configGet).toHaveBeenCalledWith('LOGIN_CHALLENGE_HMAC_KEY');
    });

    it('accepts the matching secret in constant time', () => {
      const challenge = challengeWith({ secretHash: hmac('123456') });

      expect(service.secretMatches(challenge, '123456')).toBe(true);
      expect(timingSafeEqual).toHaveBeenCalled();
    });

    it('rejects a different secret', () => {
      const challenge = challengeWith({ secretHash: hmac('123456') });
      expect(service.secretMatches(challenge, '654321')).toBe(false);
    });

    it('rejects a hash made with another key', () => {
      const otherKeyHash = createHmac('sha256', 'r'.repeat(32))
        .update('123456')
        .digest('hex');
      const challenge = challengeWith({ secretHash: otherKeyHash });

      expect(service.secretMatches(challenge, '123456')).toBe(false);
    });
  });

  describe('magic link token', () => {
    const secret = 'A'.repeat(43);

    it('builds and parses attemptId.secret', () => {
      const token = service.buildMagicLinkToken(attemptId, secret);

      expect(token).toBe(`${attemptId}.${secret}`);
      expect(service.parseMagicLinkToken(token)).toEqual({ attemptId, secret });
    });

    it.each([
      ['no separator', `${attemptId}${secret}`],
      ['two separators', `${attemptId}.${secret}.x`],
      ['attemptId is not a UUID', `not-a-uuid.${secret}`],
      ['secret too short', `${attemptId}.${'A'.repeat(42)}`],
      ['secret too long', `${attemptId}.${'A'.repeat(44)}`],
      ['secret not base64url', `${attemptId}.${'+'.repeat(43)}`],
      ['empty token', ''],
    ])('returns null when %s', (_case, token) => {
      expect(service.parseMagicLinkToken(token)).toBeNull();
    });
  });

  describe('TTL', () => {
    const lastSentAt = new Date('2026-11-21T10:00:00.000Z');
    const challenge = challengeWith({ lastSentAt });

    it('expires 10 minutes after last_sent_at', () => {
      expect(service.expiresAt(challenge)).toEqual(
        new Date('2026-11-21T10:10:00.000Z'),
      );
    });

    it('is valid one second before the end', () => {
      expect(
        service.isExpired(challenge, new Date('2026-11-21T10:09:59.000Z')),
      ).toBe(false);
    });

    it('is expired exactly at the end and after it', () => {
      expect(
        service.isExpired(challenge, new Date('2026-11-21T10:10:00.000Z')),
      ).toBe(true);
      expect(
        service.isExpired(challenge, new Date('2026-11-21T10:10:01.000Z')),
      ).toBe(true);
    });
  });

  describe('resend pause', () => {
    const lastSentAt = new Date('2026-11-21T10:00:00.000Z');
    const challenge = challengeWith({ lastSentAt });

    it('counts the seconds left, rounded up', () => {
      expect(
        service.secondsUntilResend(
          challenge,
          new Date('2026-11-21T10:00:18.500Z'),
        ),
      ).toBe(42);
    });

    it('is 0 at exactly 60 seconds and after', () => {
      expect(
        service.secondsUntilResend(
          challenge,
          new Date('2026-11-21T10:01:00.000Z'),
        ),
      ).toBe(0);
      expect(
        service.secondsUntilResend(
          challenge,
          new Date('2026-11-21T10:05:00.000Z'),
        ),
      ).toBe(0);
    });
  });

  describe('database access', () => {
    it('creates an attempt that stores only the HMAC of the secret', async () => {
      const { challenge, secret } = await service.create(
        'user-id',
        LoginChallengeMethod.OTP,
      );

      expect(secret).toMatch(/^\d{6}$/);
      expect(challenge).toMatchObject({
        id: attemptId,
        userId: 'user-id',
        method: LoginChallengeMethod.OTP,
        secretHash: hmac(secret),
        lastSentAt: expect.any(Date) as Date,
      });
      expect(JSON.stringify(challenge)).not.toContain(`"${secret}"`);
    });

    it('finds the unconsumed attempt of the user without a lock', async () => {
      await service.findActiveForUser('user-id');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { userId: 'user-id', consumedAt: IsNull() },
      });
    });

    it('finds and locks the unconsumed attempt of the user', async () => {
      await service.findActiveForUserForUpdate('user-id');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { userId: 'user-id', consumedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('finds an attempt by id without a lock', async () => {
      await service.findById(attemptId);

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: attemptId },
      });
    });

    it('finds and locks an attempt by id', async () => {
      await service.findByIdForUpdate(attemptId);

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: attemptId },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('counts a wrong OTP and keeps the attempt open below five', async () => {
      const updated = await service.registerWrongOtp(
        challengeWith({ attempts: 3 }),
      );

      expect(repository.update).toHaveBeenCalledWith(attemptId, {
        attempts: 4,
        consumedAt: null,
        consumedReason: null,
      });
      expect(updated.attempts).toBe(4);
    });

    it('consumes the attempt as attempts_exhausted on the fifth wrong OTP', async () => {
      const updated = await service.registerWrongOtp(
        challengeWith({ attempts: 4 }),
      );

      expect(repository.update).toHaveBeenCalledWith(attemptId, {
        attempts: 5,
        consumedAt: expect.any(Date) as Date,
        consumedReason: LoginChallengeConsumedReason.ATTEMPTS_EXHAUSTED,
      });
      expect(updated.consumedReason).toBe(
        LoginChallengeConsumedReason.ATTEMPTS_EXHAUSTED,
      );
    });

    it('rotates the secret in the same row and resets the counter', async () => {
      const lastSentAt = new Date('2026-11-21T10:00:00.000Z');
      const { challenge, secret } = await service.rotateSecret(
        challengeWith({
          method: LoginChallengeMethod.OTP,
          secretHash: hmac('111111'),
          attempts: 3,
          lastSentAt,
        }),
      );

      expect(repository.update).toHaveBeenCalledWith(attemptId, {
        secretHash: hmac(secret),
        lastSentAt: expect.any(Date) as Date,
        attempts: 0,
      });
      expect(secret).toMatch(/^\d{6}$/);
      expect(challenge).toMatchObject({ id: attemptId, attempts: 0 });
      expect(challenge.lastSentAt.getTime()).toBeGreaterThan(
        lastSentAt.getTime(),
      );
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('consumes an attempt with a reason', async () => {
      await service.consume(
        challengeWith({}),
        LoginChallengeConsumedReason.REPLACED,
      );

      expect(repository.update).toHaveBeenCalledWith(attemptId, {
        consumedAt: expect.any(Date) as Date,
        consumedReason: LoginChallengeConsumedReason.REPLACED,
      });
    });
  });
});
