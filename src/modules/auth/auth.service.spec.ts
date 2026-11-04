import {
  BadRequestException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { ConfigService } from '@/core/config/config.service';
import { MailService } from '@/core/mail/mail.service';
import { User } from '@/modules/users/user.entity';
import { UserStatus } from '@/modules/users/user.types';
import { UsersService } from '@/modules/users/users.service';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { RegistrationChallengeService } from './registration-challenge.service';
import { RegistrationChallenge } from './registration-challenge.entity';
import {
  RegistrationChallengeConsumedReason,
  RegistrationChallengeMethod,
} from './registration-challenge.types';

// The real decorator needs a DataSource; unit tests only check the service logic.
jest.mock('typeorm-transactional', () => ({
  Transactional: () => () => undefined,
}));

describe('AuthService', () => {
  const dto = { email: 'user@example.com', password: 'secret12' };
  const hash = '$argon2id$hash';

  let service: AuthService;
  let config: { get: jest.Mock };
  let passwordService: { hash: jest.Mock };
  let usersService: {
    createUser: jest.Mock;
    findByIdForUpdate: jest.Mock;
    updateStatus: jest.Mock;
  };
  let challengeService: {
    create: jest.Mock;
    findOtpAttemptForUpdate: jest.Mock;
    findMagicLinkAttemptForUpdate: jest.Mock;
    secretMatches: jest.Mock;
    registerWrongSecret: jest.Mock;
    consume: jest.Mock;
  };
  let mailService: {
    sendRegistrationOtp: jest.Mock;
    sendRegistrationMagicLink: jest.Mock;
  };

  beforeEach(async () => {
    config = { get: jest.fn() };
    passwordService = { hash: jest.fn().mockResolvedValue(hash) };
    usersService = {
      createUser: jest.fn().mockResolvedValue({
        id: 'user-id',
        email: dto.email,
        passwordHash: hash,
        status: UserStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      } satisfies User),
      findByIdForUpdate: jest.fn(),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    };
    challengeService = {
      create: jest.fn().mockResolvedValue({
        challenge: {
          id: 'attempt-id',
          method: RegistrationChallengeMethod.OTP,
        },
        secret: '123456',
      }),
      findOtpAttemptForUpdate: jest.fn(),
      findMagicLinkAttemptForUpdate: jest.fn(),
      secretMatches: jest.fn(),
      registerWrongSecret: jest.fn(),
      consume: jest.fn().mockResolvedValue(undefined),
    };
    mailService = {
      sendRegistrationOtp: jest.fn().mockResolvedValue(undefined),
      sendRegistrationMagicLink: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: ConfigService, useValue: config },
        { provide: PasswordService, useValue: passwordService },
        { provide: UsersService, useValue: usersService },
        {
          provide: RegistrationChallengeService,
          useValue: challengeService,
        },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register with confirmation disabled', () => {
    beforeEach(() => config.get.mockReturnValue(false));

    it('saves an active user with the password hash, not the password', async () => {
      await service.register(dto);

      expect(passwordService.hash).toHaveBeenCalledWith(dto.password);
      expect(usersService.createUser).toHaveBeenCalledWith({
        email: dto.email,
        passwordHash: hash,
        status: UserStatus.ACTIVE,
      });
    });

    it('does not send an email', async () => {
      await service.register(dto);

      expect(mailService.sendRegistrationOtp).not.toHaveBeenCalled();
      expect(mailService.sendRegistrationMagicLink).not.toHaveBeenCalled();
    });

    it('returns only id, email and status', async () => {
      await expect(service.register(dto)).resolves.toEqual({
        id: 'user-id',
        email: dto.email,
        status: UserStatus.ACTIVE,
      });
    });
  });

  describe('register with confirmation enabled', () => {
    const confirmUrl = 'http://localhost:3000/register/confirm';

    const useMethod = (method: RegistrationChallengeMethod) =>
      config.get.mockImplementation(
        (key: string) =>
          ({
            REGISTRATION_EMAIL_CONFIRMATION_ENABLED: true,
            REGISTRATION_EMAIL_CONFIRMATION_METHOD: method,
            REGISTRATION_CONFIRM_URL: confirmUrl,
          })[key],
      );

    beforeEach(() => useMethod(RegistrationChallengeMethod.OTP));

    it('saves a pending user and a challenge with the configured method', async () => {
      await service.register(dto);

      expect(usersService.createUser).toHaveBeenCalledWith({
        email: dto.email,
        passwordHash: hash,
        status: UserStatus.PENDING,
      });
      expect(challengeService.create).toHaveBeenCalledWith(
        'user-id',
        RegistrationChallengeMethod.OTP,
      );
    });

    it('returns the pending result without the secret', async () => {
      await expect(service.register(dto)).resolves.toEqual({
        confirmationRequired: true,
        method: RegistrationChallengeMethod.OTP,
        attemptId: 'attempt-id',
        expiresInSeconds: 600,
        resendAfterSeconds: 60,
      });
    });

    it('emails the OTP code', async () => {
      await service.register(dto);

      expect(mailService.sendRegistrationOtp).toHaveBeenCalledWith(
        dto.email,
        '123456',
      );
    });

    it('emails a magic link with only the secret in the fragment', async () => {
      useMethod(RegistrationChallengeMethod.MAGIC_LINK);
      challengeService.create.mockResolvedValue({
        challenge: {
          id: 'attempt-id',
          method: RegistrationChallengeMethod.MAGIC_LINK,
        },
        secret: 'token',
      });

      await service.register(dto);

      expect(mailService.sendRegistrationMagicLink).toHaveBeenCalledWith(
        dto.email,
        `${confirmUrl}#token`,
      );
    });

    it('returns 503 and keeps the user and attempt when the email fails', async () => {
      mailService.sendRegistrationOtp.mockRejectedValue(
        new Error('ECONNREFUSED'),
      );

      await expect(service.register(dto)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(usersService.createUser).toHaveBeenCalled();
      expect(challengeService.create).toHaveBeenCalled();
    });
  });

  describe('confirmRegistration', () => {
    const attemptId = '0b8e5a52-3c0f-4c1e-9c1a-2f1b6f9d4e7a';
    const otpDto = { attemptId, code: '123456' };
    const magicLinkDto = { token: 'token' };
    const inTenMinutes = () => new Date(Date.now() + 600_000);

    const attempt = (
      overrides: Partial<RegistrationChallenge> = {},
    ): RegistrationChallenge =>
      ({
        id: attemptId,
        userId: 'user-id',
        method: RegistrationChallengeMethod.OTP,
        secretHash: 'hash',
        expiresAt: inTenMinutes(),
        attempts: 0,
        consumedAt: null,
        consumedReason: null,
        ...overrides,
      }) as RegistrationChallenge;

    const pendingUser = (status = UserStatus.PENDING) => ({
      id: 'user-id',
      email: dto.email,
      passwordHash: hash,
      status,
    });

    const expectInvalid = async (promise: Promise<unknown>) => {
      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      await expect(promise).rejects.toThrow(
        'Invalid or expired confirmation code or token',
      );
    };

    const expectExhausted = async (promise: Promise<unknown>) => {
      await expect(promise).rejects.toBeInstanceOf(HttpException);
      await expect(promise).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
      });
    };

    const useOtpAttempt = (challenge: RegistrationChallenge) =>
      challengeService.findOtpAttemptForUpdate.mockResolvedValue(challenge);

    beforeEach(() => {
      usersService.findByIdForUpdate.mockResolvedValue(pendingUser());
    });

    describe('success', () => {
      const activeProfile = {
        id: 'user-id',
        email: dto.email,
        status: UserStatus.ACTIVE,
      };

      it('activates the user and consumes the OTP attempt as confirmed', async () => {
        const challenge = attempt();
        useOtpAttempt(challenge);
        challengeService.secretMatches.mockReturnValue(true);

        await expect(service.confirmRegistration(otpDto)).resolves.toEqual(
          activeProfile,
        );
        expect(challengeService.findOtpAttemptForUpdate).toHaveBeenCalledWith(
          attemptId,
        );
        expect(challengeService.secretMatches).toHaveBeenCalledWith(
          challenge,
          '123456',
        );
        expect(usersService.updateStatus).toHaveBeenCalledWith(
          'user-id',
          UserStatus.ACTIVE,
        );
        expect(challengeService.consume).toHaveBeenCalledWith(
          challenge,
          RegistrationChallengeConsumedReason.CONFIRMED,
        );
      });

      it('confirms a magic link through the same path', async () => {
        const challenge = attempt({
          method: RegistrationChallengeMethod.MAGIC_LINK,
        });
        challengeService.findMagicLinkAttemptForUpdate.mockResolvedValue(
          challenge,
        );
        challengeService.secretMatches.mockReturnValue(true);

        await expect(
          service.confirmRegistration(magicLinkDto),
        ).resolves.toEqual(activeProfile);
        expect(
          challengeService.findMagicLinkAttemptForUpdate,
        ).toHaveBeenCalledWith('token');
        expect(challengeService.findOtpAttemptForUpdate).not.toHaveBeenCalled();
        expect(challengeService.secretMatches).toHaveBeenCalledWith(
          challenge,
          'token',
        );
        expect(challengeService.consume).toHaveBeenCalledWith(
          challenge,
          RegistrationChallengeConsumedReason.CONFIRMED,
        );
      });

      it('accepts the correct code on the fifth entry', async () => {
        useOtpAttempt(attempt({ attempts: 4 }));
        challengeService.secretMatches.mockReturnValue(true);

        await expect(service.confirmRegistration(otpDto)).resolves.toEqual(
          activeProfile,
        );
      });

      it('does not read the method from the config', async () => {
        useOtpAttempt(attempt());
        challengeService.secretMatches.mockReturnValue(true);

        await service.confirmRegistration(otpDto);

        expect(config.get).not.toHaveBeenCalled();
      });
    });

    describe('wrong code', () => {
      beforeEach(() => challengeService.secretMatches.mockReturnValue(false));

      it('increments the counter and returns 400', async () => {
        const challenge = attempt({ attempts: 1 });
        useOtpAttempt(challenge);
        challengeService.registerWrongSecret.mockResolvedValue({
          ...challenge,
          attempts: 2,
        });

        await expectInvalid(service.confirmRegistration(otpDto));
        expect(challengeService.registerWrongSecret).toHaveBeenCalledWith(
          challenge,
        );
        expect(usersService.updateStatus).not.toHaveBeenCalled();
      });

      it('returns 400 (not 429) on the fifth wrong code that consumes the attempt', async () => {
        const challenge = attempt({ attempts: 4 });
        useOtpAttempt(challenge);
        challengeService.registerWrongSecret.mockResolvedValue({
          ...challenge,
          attempts: 5,
          consumedAt: new Date(),
          consumedReason:
            RegistrationChallengeConsumedReason.ATTEMPTS_EXHAUSTED,
        });

        await expectInvalid(service.confirmRegistration(otpDto));
      });
    });

    describe('rejected before the comparison', () => {
      it('returns 429 after the attempt was exhausted, even for the correct code', async () => {
        useOtpAttempt(
          attempt({
            attempts: 5,
            consumedAt: new Date(),
            consumedReason:
              RegistrationChallengeConsumedReason.ATTEMPTS_EXHAUSTED,
          }),
        );
        challengeService.secretMatches.mockReturnValue(true);

        await expectExhausted(service.confirmRegistration(otpDto));
        expect(challengeService.secretMatches).not.toHaveBeenCalled();
        expect(usersService.updateStatus).not.toHaveBeenCalled();
      });

      it('returns 429 when the counter is at the limit (defensive)', async () => {
        useOtpAttempt(attempt({ attempts: 5 }));

        await expectExhausted(service.confirmRegistration(otpDto));
        expect(challengeService.registerWrongSecret).not.toHaveBeenCalled();
      });

      it.each([
        RegistrationChallengeConsumedReason.CONFIRMED,
        RegistrationChallengeConsumedReason.REPLACED,
        RegistrationChallengeConsumedReason.USER_INACTIVE,
      ])('returns 400 when the attempt was consumed as %s', async (reason) => {
        useOtpAttempt(
          attempt({ consumedAt: new Date(), consumedReason: reason }),
        );
        challengeService.findMagicLinkAttemptForUpdate.mockResolvedValue(
          attempt({ consumedAt: new Date(), consumedReason: reason }),
        );

        await expectInvalid(service.confirmRegistration(otpDto));
        await expectInvalid(service.confirmRegistration(magicLinkDto));
        expect(challengeService.secretMatches).not.toHaveBeenCalled();
      });

      it('returns 400 when the attempt is not found (or has another method)', async () => {
        challengeService.findOtpAttemptForUpdate.mockResolvedValue(null);
        challengeService.findMagicLinkAttemptForUpdate.mockResolvedValue(null);

        await expectInvalid(service.confirmRegistration(otpDto));
        await expectInvalid(service.confirmRegistration(magicLinkDto));
      });

      it('returns 400 when expired and does not count an entry', async () => {
        useOtpAttempt(attempt({ expiresAt: new Date(Date.now() - 1) }));

        await expectInvalid(service.confirmRegistration(otpDto));
        expect(challengeService.secretMatches).not.toHaveBeenCalled();
        expect(challengeService.registerWrongSecret).not.toHaveBeenCalled();
      });
    });

    describe('user is no longer pending', () => {
      beforeEach(() => {
        useOtpAttempt(attempt());
        challengeService.secretMatches.mockReturnValue(true);
      });

      it.each([UserStatus.BLOCKED, UserStatus.DELETING, UserStatus.DELETED])(
        'consumes the attempt as user_inactive when the user is %s',
        async (status) => {
          usersService.findByIdForUpdate.mockResolvedValue(pendingUser(status));

          await expectInvalid(service.confirmRegistration(otpDto));
          expect(challengeService.consume).toHaveBeenCalledWith(
            expect.objectContaining({ id: attemptId }),
            RegistrationChallengeConsumedReason.USER_INACTIVE,
          );
          expect(usersService.updateStatus).not.toHaveBeenCalled();
        },
      );

      it('returns 400 without consuming when the user is already active', async () => {
        usersService.findByIdForUpdate.mockResolvedValue(
          pendingUser(UserStatus.ACTIVE),
        );

        await expectInvalid(service.confirmRegistration(otpDto));
        expect(challengeService.consume).not.toHaveBeenCalled();
        expect(usersService.updateStatus).not.toHaveBeenCalled();
      });
    });
  });
});
