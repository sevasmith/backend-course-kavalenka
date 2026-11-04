import {
  BadRequestException,
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
import { RegistrationChallengeMethod } from './registration-challenge.types';

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
  let usersService: { createUser: jest.Mock };
  let challengeService: {
    create: jest.Mock;
    findOtpAttempt: jest.Mock;
    findMagicLinkAttempt: jest.Mock;
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
    };
    challengeService = {
      create: jest.fn().mockResolvedValue({
        challenge: {
          id: 'attempt-id',
          method: RegistrationChallengeMethod.OTP,
        },
        secret: '123456',
      }),
      findOtpAttempt: jest.fn(),
      findMagicLinkAttempt: jest.fn(),
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

  describe('confirmRegistration: finding the attempt', () => {
    const attemptId = '0b8e5a52-3c0f-4c1e-9c1a-2f1b6f9d4e7a';
    const otpDto = { attemptId, code: '123456' };
    const magicLinkDto = { token: 'token' };
    const attempt = (consumedAt: Date | null = null) => ({
      id: attemptId,
      consumedAt,
    });

    const expectInvalid = async (promise: Promise<unknown>) => {
      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      await expect(promise).rejects.toThrow(
        'Invalid or expired confirmation code or token',
      );
    };

    it('finds an OTP attempt by id', async () => {
      challengeService.findOtpAttempt.mockResolvedValue(attempt());

      await expect(service.confirmRegistration(otpDto)).resolves.toEqual(
        attempt(),
      );
      expect(challengeService.findOtpAttempt).toHaveBeenCalledWith(attemptId);
      expect(challengeService.findMagicLinkAttempt).not.toHaveBeenCalled();
    });

    it('finds a magic link attempt by the token', async () => {
      challengeService.findMagicLinkAttempt.mockResolvedValue(attempt());

      await expect(service.confirmRegistration(magicLinkDto)).resolves.toEqual(
        attempt(),
      );
      expect(challengeService.findMagicLinkAttempt).toHaveBeenCalledWith(
        'token',
      );
      expect(challengeService.findOtpAttempt).not.toHaveBeenCalled();
    });

    it('does not read the method from the config', async () => {
      challengeService.findOtpAttempt.mockResolvedValue(attempt());

      await service.confirmRegistration(otpDto);

      expect(config.get).not.toHaveBeenCalled();
    });

    it('returns 400 when the attempt is not found (or has another method)', async () => {
      challengeService.findOtpAttempt.mockResolvedValue(null);
      challengeService.findMagicLinkAttempt.mockResolvedValue(null);

      await expectInvalid(service.confirmRegistration(otpDto));
      await expectInvalid(service.confirmRegistration(magicLinkDto));
    });

    it('returns the same 400 when the attempt is already consumed', async () => {
      challengeService.findOtpAttempt.mockResolvedValue(attempt(new Date()));
      challengeService.findMagicLinkAttempt.mockResolvedValue(
        attempt(new Date()),
      );

      await expectInvalid(service.confirmRegistration(otpDto));
      await expectInvalid(service.confirmRegistration(magicLinkDto));
    });
  });
});
