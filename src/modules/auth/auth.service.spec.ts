import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { ConfigService } from '@/core/config/config.service';
import { MailService } from '@/core/mail/mail.service';
import { ErrorCode } from '@/core/http/api-error';
import { User } from '@/modules/users/user.entity';
import { UserStatus } from '@/modules/users/user.types';
import { UsersService } from '@/modules/users/users.service';
import { RbacDefaultRoleService } from '@/modules/rbac/rbac-default-role.service';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { RegistrationChallengeService } from './registration-challenge.service';
import { TokenService } from './token.service';
import { LoginAttemptLimiter } from './login-attempt-limiter';
import { AuditIdService } from './audit-id.service';
import { LoginChallengeService } from './login-challenge.service';
import {
  LoginChallengeConsumedReason,
  LoginChallengeMethod,
} from './login-challenge.types';
import {
  INVALID_CREDENTIALS_MESSAGE,
  INVALID_SESSION_MESSAGE,
} from './auth.types';
import { TokenFailure } from './token.types';
import { RegistrationChallenge } from './registration-challenge.entity';
import {
  RegistrationChallengeConsumedReason,
  RegistrationChallengeMethod,
} from './registration-challenge.types';

// The real decorator needs a DataSource; unit tests only check the service logic.
// `IsolationLevel` is read at import time by the RBAC services AuthService
// now depends on.
jest.mock('typeorm-transactional', () => ({
  Transactional: () => () => undefined,
  IsolationLevel: { REPEATABLE_READ: 'REPEATABLE READ' },
}));

/** What the fake `AuditIdService` returns for any email. */
const EMAIL_ID = 'email-audit-id';

describe('AuthService', () => {
  const dto = { email: 'user@example.com', password: 'secret12' };
  const hash = '$argon2id$hash';

  let service: AuthService;
  let config: { get: jest.Mock };
  let passwordService: {
    hash: jest.Mock;
    verify: jest.Mock;
    verifyDummy: jest.Mock;
  };
  let usersService: {
    createUser: jest.Mock;
    findByEmail: jest.Mock;
    findByIdForUpdate: jest.Mock;
    findStatusById: jest.Mock;
    updateStatus: jest.Mock;
  };
  let challengeService: {
    create: jest.Mock;
    findOtpAttemptForUpdate: jest.Mock;
    findMagicLinkAttemptForUpdate: jest.Mock;
    findLatestForUserForUpdate: jest.Mock;
    secretMatches: jest.Mock;
    registerWrongSecret: jest.Mock;
    consume: jest.Mock;
  };
  let mailService: {
    sendRegistrationOtp: jest.Mock;
    sendRegistrationMagicLink: jest.Mock;
    sendLoginOtp: jest.Mock;
    sendLoginMagicLink: jest.Mock;
  };
  let loginChallengeService: {
    findActiveForUser: jest.Mock;
    findActiveForUserForUpdate: jest.Mock;
    create: jest.Mock;
    consume: jest.Mock;
    secondsUntilResend: jest.Mock;
    buildMagicLinkToken: jest.Mock;
    findById: jest.Mock;
    findByIdForUpdate: jest.Mock;
    registerWrongOtp: jest.Mock;
    isExpired: jest.Mock;
    secretMatches: jest.Mock;
    parseMagicLinkToken: jest.Mock;
    rotateSecret: jest.Mock;
  };
  let defaultRoleService: { assignToActivatedUser: jest.Mock };
  let tokenService: {
    signAccess: jest.Mock;
    signRefresh: jest.Mock;
    verifyRefresh: jest.Mock;
    verifyAccess: jest.Mock;
  };
  let limiter: { reserve: jest.Mock; reset: jest.Mock; release: jest.Mock };

  let logs: string[];

  beforeEach(async () => {
    // Captures every log line (and keeps the test output quiet).
    logs = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((message: unknown) => {
          logs.push(String(message));
        });
    }

    config = { get: jest.fn() };
    passwordService = {
      hash: jest.fn().mockResolvedValue(hash),
      verify: jest.fn(),
      verifyDummy: jest.fn().mockResolvedValue(false),
    };
    usersService = {
      createUser: jest.fn().mockResolvedValue({
        id: 'user-id',
        email: dto.email,
        passwordHash: hash,
        status: UserStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      } satisfies User),
      findByEmail: jest.fn(),
      findByIdForUpdate: jest.fn(),
      findStatusById: jest.fn(),
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
      findLatestForUserForUpdate: jest.fn(),
      secretMatches: jest.fn(),
      registerWrongSecret: jest.fn(),
      consume: jest.fn().mockResolvedValue(undefined),
    };
    mailService = {
      sendRegistrationOtp: jest.fn().mockResolvedValue(undefined),
      sendRegistrationMagicLink: jest.fn().mockResolvedValue(undefined),
      sendLoginOtp: jest.fn().mockResolvedValue(undefined),
      sendLoginMagicLink: jest.fn().mockResolvedValue(undefined),
    };
    loginChallengeService = {
      findActiveForUser: jest.fn().mockResolvedValue(null),
      findActiveForUserForUpdate: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({
        challenge: {
          id: 'login-attempt-id',
          userId: 'user-id',
          method: LoginChallengeMethod.OTP,
        },
        secret: '654321',
      }),
      consume: jest.fn().mockResolvedValue(undefined),
      secondsUntilResend: jest.fn().mockReturnValue(0),
      buildMagicLinkToken: jest.fn(
        (attemptId: string, secret: string) => `${attemptId}.${secret}`,
      ),
      findById: jest.fn().mockResolvedValue(null),
      findByIdForUpdate: jest.fn().mockResolvedValue(null),
      registerWrongOtp: jest.fn(),
      isExpired: jest.fn().mockReturnValue(false),
      secretMatches: jest.fn().mockReturnValue(false),
      parseMagicLinkToken: jest.fn().mockReturnValue(null),
      rotateSecret: jest.fn(),
    };
    defaultRoleService = {
      assignToActivatedUser: jest.fn().mockResolvedValue('assigned'),
    };

    tokenService = {
      signAccess: jest.fn().mockReturnValue('access.jwt'),
      signRefresh: jest.fn().mockReturnValue('refresh.jwt'),
      verifyRefresh: jest.fn(),
      verifyAccess: jest.fn(),
    };

    limiter = {
      reserve: jest.fn().mockReturnValue({ key: 'slot', at: 1 }),
      reset: jest.fn(),
      release: jest.fn(),
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
        { provide: RbacDefaultRoleService, useValue: defaultRoleService },
        { provide: TokenService, useValue: tokenService },
        { provide: LoginAttemptLimiter, useValue: limiter },
        { provide: LoginChallengeService, useValue: loginChallengeService },
        { provide: AuditIdService, useValue: { forEmail: () => EMAIL_ID } },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    // Drop Nest's own startup lines: only the service's logs are checked.
    logs = [];
  });

  afterEach(() => jest.restoreAllMocks());

  /**
   * The log must not contain the password, its hash, the secret or the email.
   */
  const expectLogsWithout = (...values: string[]) => {
    expect(logs.length).toBeGreaterThan(0);
    for (const value of [dto.email, dto.password, hash, ...values]) {
      for (const line of logs) {
        expect(line).not.toContain(value);
      }
    }
  };

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

    it('gives the new active user the user role', async () => {
      await service.register(dto);

      expect(defaultRoleService.assignToActivatedUser).toHaveBeenCalledWith(
        'user-id',
      );
    });

    it('fails the registration when the role cannot be assigned', async () => {
      const failure = new Error('db down');
      defaultRoleService.assignToActivatedUser.mockRejectedValue(failure);

      await expect(service.register(dto)).rejects.toBe(failure);
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

    it('does not give a pending user any role', async () => {
      await service.register(dto);

      expect(defaultRoleService.assignToActivatedUser).not.toHaveBeenCalled();
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
        expect(defaultRoleService.assignToActivatedUser).toHaveBeenCalledWith(
          'user-id',
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
        expect(defaultRoleService.assignToActivatedUser).not.toHaveBeenCalled();
      });
    });
  });

  describe('register logs', () => {
    it('logs an active registration with the user id only', async () => {
      config.get.mockReturnValue(false);

      await service.register(dto);

      expect(logs).toContain(
        'Registration created, status=active, userId=user-id',
      );
      expectLogsWithout();
    });

    it('logs the pending registration and the sent email without the code', async () => {
      config.get.mockImplementation(
        (key: string) =>
          ({
            REGISTRATION_EMAIL_CONFIRMATION_ENABLED: true,
            REGISTRATION_EMAIL_CONFIRMATION_METHOD:
              RegistrationChallengeMethod.OTP,
          })[key],
      );

      await service.register(dto);

      expect(logs).toEqual([
        'Registration created, status=pending, attemptId=attempt-id',
        'Registration email sent, method=otp, attemptId=attempt-id',
      ]);
      expectLogsWithout('123456');
    });

    it('logs a failed email without the code', async () => {
      config.get.mockImplementation(
        (key: string) =>
          ({ REGISTRATION_EMAIL_CONFIRMATION_ENABLED: true })[key],
      );
      mailService.sendRegistrationOtp.mockRejectedValue(
        Object.assign(new Error(`550 <${dto.email}>: Recipient rejected`), {
          code: 'EENVELOPE',
        }),
      );

      await expect(service.register(dto)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(logs).toContainEqual(
        expect.stringMatching(/Registration email failed.*: EENVELOPE$/),
      );
      // The SMTP message quotes the address: only the code is logged.
      expectLogsWithout('123456', 'Recipient rejected');
    });

    it('logs a taken email without the email and still returns 409', async () => {
      config.get.mockReturnValue(false);
      usersService.createUser.mockRejectedValue(
        new ConflictException('Email is already registered'),
      );

      await expect(service.register(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(logs).toEqual(['Registration rejected, reason=email_taken']);
      expectLogsWithout();
    });
  });

  describe('resendRegistration', () => {
    const resendDto = { email: dto.email };
    const secondsAgo = (seconds: number) =>
      new Date(Date.now() - seconds * 1000);

    const oldAttempt = (
      overrides: Partial<RegistrationChallenge> = {},
    ): RegistrationChallenge =>
      ({
        id: 'old-attempt-id',
        userId: 'user-id',
        method: RegistrationChallengeMethod.OTP,
        secretHash: 'hash',
        expiresAt: new Date(Date.now() + 600_000),
        attempts: 2,
        lastSentAt: secondsAgo(61),
        consumedAt: null,
        consumedReason: null,
        ...overrides,
      }) as RegistrationChallenge;

    const user = (status = UserStatus.PENDING) => ({
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

    const expectTooSoon = async (promise: Promise<unknown>) => {
      await expect(promise).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
      });
    };

    const expectNothingWritten = () => {
      expect(challengeService.consume).not.toHaveBeenCalled();
      expect(challengeService.create).not.toHaveBeenCalled();
      expect(mailService.sendRegistrationOtp).not.toHaveBeenCalled();
      expect(mailService.sendRegistrationMagicLink).not.toHaveBeenCalled();
    };

    beforeEach(() => {
      // The flag is off: an issued attempt can be resent anyway.
      config.get.mockImplementation(
        (key: string) =>
          ({
            REGISTRATION_EMAIL_CONFIRMATION_ENABLED: false,
            REGISTRATION_EMAIL_CONFIRMATION_METHOD:
              RegistrationChallengeMethod.OTP,
            REGISTRATION_CONFIRM_URL: 'http://localhost:3000/register/confirm',
          })[key],
      );
      usersService.findByEmail.mockResolvedValue(user());
      usersService.findByIdForUpdate.mockResolvedValue(user());
      challengeService.findLatestForUserForUpdate.mockResolvedValue(
        oldAttempt(),
      );
      challengeService.create.mockResolvedValue({
        challenge: {
          id: 'new-attempt-id',
          method: RegistrationChallengeMethod.OTP,
        },
        secret: '654321',
      });
    });

    describe('success', () => {
      it('replaces the old attempt with a new one and returns the 202 body', async () => {
        await expect(service.resendRegistration(resendDto)).resolves.toEqual({
          confirmationRequired: true,
          method: RegistrationChallengeMethod.OTP,
          attemptId: 'new-attempt-id',
          expiresInSeconds: 600,
          resendAfterSeconds: 60,
        });
        expect(challengeService.consume).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'old-attempt-id' }),
          RegistrationChallengeConsumedReason.REPLACED,
        );
        // A new row: new secret, fresh TTL and a counter at 0.
        expect(challengeService.create).toHaveBeenCalledWith(
          'user-id',
          RegistrationChallengeMethod.OTP,
        );
      });

      it('emails the new code', async () => {
        await service.resendRegistration(resendDto);

        expect(mailService.sendRegistrationOtp).toHaveBeenCalledWith(
          dto.email,
          '654321',
        );
      });

      it('keeps the method of the old attempt, not the configured one', async () => {
        challengeService.findLatestForUserForUpdate.mockResolvedValue(
          oldAttempt({ method: RegistrationChallengeMethod.MAGIC_LINK }),
        );
        challengeService.create.mockResolvedValue({
          challenge: {
            id: 'new-attempt-id',
            method: RegistrationChallengeMethod.MAGIC_LINK,
          },
          secret: 'token',
        });

        await service.resendRegistration(resendDto);

        expect(challengeService.create).toHaveBeenCalledWith(
          'user-id',
          RegistrationChallengeMethod.MAGIC_LINK,
        );
        expect(mailService.sendRegistrationMagicLink).toHaveBeenCalledWith(
          dto.email,
          'http://localhost:3000/register/confirm#token',
        );
      });

      it('allows a resend after the attempt was exhausted by five wrong codes', async () => {
        challengeService.findLatestForUserForUpdate.mockResolvedValue(
          oldAttempt({
            attempts: 5,
            consumedAt: secondsAgo(61),
            consumedReason:
              RegistrationChallengeConsumedReason.ATTEMPTS_EXHAUSTED,
          }),
        );

        await expect(
          service.resendRegistration(resendDto),
        ).resolves.toMatchObject({ attemptId: 'new-attempt-id' });
        expect(challengeService.consume).toHaveBeenCalledWith(
          expect.anything(),
          RegistrationChallengeConsumedReason.REPLACED,
        );
      });

      it('allows a resend after the attempt expired', async () => {
        challengeService.findLatestForUserForUpdate.mockResolvedValue(
          oldAttempt({ expiresAt: secondsAgo(1), lastSentAt: secondsAgo(601) }),
        );

        await expect(
          service.resendRegistration(resendDto),
        ).resolves.toMatchObject({ attemptId: 'new-attempt-id' });
      });

      it('locks the attempt before the user, like the confirmation', async () => {
        await service.resendRegistration(resendDto);

        const [attemptLock] =
          challengeService.findLatestForUserForUpdate.mock.invocationCallOrder;
        const [userLock] =
          usersService.findByIdForUpdate.mock.invocationCallOrder;
        expect(attemptLock).toBeLessThan(userLock);
      });

      it('logs the replacement without the code or the email', async () => {
        await service.resendRegistration(resendDto);

        expect(logs).toEqual([
          'Registration attempt replaced, oldAttemptId=old-attempt-id, ' +
            'attemptId=new-attempt-id, userId=user-id',
          'Registration email sent, method=otp, attemptId=new-attempt-id',
        ]);
        expectLogsWithout('654321');
      });
    });

    describe('too soon', () => {
      it('returns 429 when the last email was sent less than 60 seconds ago', async () => {
        challengeService.findLatestForUserForUpdate.mockResolvedValue(
          oldAttempt({ lastSentAt: secondsAgo(30) }),
        );

        await expectTooSoon(service.resendRegistration(resendDto));
        expectNothingWritten();
      });

      it('returns 429 when a parallel resend replaced the attempt first', async () => {
        challengeService.findLatestForUserForUpdate.mockResolvedValue(
          oldAttempt({
            consumedAt: new Date(),
            consumedReason: RegistrationChallengeConsumedReason.REPLACED,
          }),
        );

        await expectTooSoon(service.resendRegistration(resendDto));
        expectNothingWritten();
      });
    });

    describe('no pending registration', () => {
      it('returns 400 for an unknown email', async () => {
        usersService.findByEmail.mockResolvedValue(null);

        await expectInvalid(service.resendRegistration(resendDto));
        expect(
          challengeService.findLatestForUserForUpdate,
        ).not.toHaveBeenCalled();
        expectNothingWritten();
      });

      it('returns 400 when the user has no attempt', async () => {
        challengeService.findLatestForUserForUpdate.mockResolvedValue(null);

        await expectInvalid(service.resendRegistration(resendDto));
        expectNothingWritten();
      });

      it.each([
        UserStatus.ACTIVE,
        UserStatus.BLOCKED,
        UserStatus.DELETING,
        UserStatus.DELETED,
      ])('returns 400 when the user is %s', async (status) => {
        usersService.findByIdForUpdate.mockResolvedValue(user(status));

        await expectInvalid(service.resendRegistration(resendDto));
        expectNothingWritten();
      });
    });

    it('returns 503 and keeps the new attempt when the email fails', async () => {
      mailService.sendRegistrationOtp.mockRejectedValue(
        new Error('ECONNREFUSED'),
      );

      await expect(
        service.resendRegistration(resendDto),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(challengeService.consume).toHaveBeenCalled();
      expect(challengeService.create).toHaveBeenCalled();
      expectLogsWithout('654321');
    });
  });

  describe('checkCredentials', () => {
    const userWith = (status: UserStatus): User => ({
      id: 'user-id',
      email: dto.email,
      passwordHash: hash,
      status,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    /** The single 401 every failed login must produce. */
    const expectInvalidCredentials = async () => {
      const error: unknown = await service
        .checkCredentials(dto)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).getResponse()).toEqual({
        code: ErrorCode.INVALID_CREDENTIALS,
        message: INVALID_CREDENTIALS_MESSAGE,
      });
    };

    it('returns the id of an active user with the right password', async () => {
      usersService.findByEmail.mockResolvedValue(userWith(UserStatus.ACTIVE));
      passwordService.verify.mockResolvedValue(true);

      await expect(service.checkCredentials(dto)).resolves.toEqual({
        id: 'user-id',
      });
      expect(usersService.findByEmail).toHaveBeenCalledWith(dto.email);
      expect(passwordService.verify).toHaveBeenCalledWith(hash, dto.password);
      expect(passwordService.verifyDummy).not.toHaveBeenCalled();
    });

    it('checks the dummy hash and rejects an unknown email', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expectInvalidCredentials();
      expect(passwordService.verifyDummy).toHaveBeenCalledWith(dto.password);
      expect(passwordService.verify).not.toHaveBeenCalled();
    });

    it('logs an unknown email by its keyed id, never the address', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expectInvalidCredentials();
      expect(logs).toEqual([
        `Login rejected, reason=unknown_email, emailId=${EMAIL_ID}`,
      ]);
      expectLogsWithout();
    });

    it('rejects a wrong password', async () => {
      usersService.findByEmail.mockResolvedValue(userWith(UserStatus.ACTIVE));
      passwordService.verify.mockResolvedValue(false);

      await expectInvalidCredentials();
      expect(logs).toEqual([
        'Login rejected, reason=wrong_password, userId=user-id',
      ]);
      expectLogsWithout();
    });

    it.each([
      UserStatus.PENDING,
      UserStatus.BLOCKED,
      UserStatus.DELETING,
      UserStatus.DELETED,
    ])(
      'rejects a %s user with the right password the same way',
      async (status) => {
        usersService.findByEmail.mockResolvedValue(userWith(status));
        passwordService.verify.mockResolvedValue(true);

        await expectInvalidCredentials();
        // The password is checked first, like for an active user.
        expect(passwordService.verify).toHaveBeenCalledWith(hash, dto.password);
        expect(logs).toEqual([
          `Login rejected, reason=user_${status}, userId=user-id`,
        ]);
      },
    );
  });

  describe('login', () => {
    const ip = '203.0.113.7';
    const activeUser: User = {
      id: 'user-id',
      email: dto.email,
      passwordHash: hash,
      status: UserStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    beforeEach(() => {
      config.get.mockReturnValue(false);
      usersService.findByEmail.mockResolvedValue(activeUser);
      passwordService.verify.mockResolvedValue(true);
    });

    it('signs both tokens for the user id', async () => {
      await expect(service.login(dto, ip)).resolves.toEqual({
        accessToken: 'access.jwt',
        refreshToken: 'refresh.jwt',
      });
      expect(config.get).toHaveBeenCalledWith(
        'LOGIN_EMAIL_CONFIRMATION_ENABLED',
      );
      expect(tokenService.signAccess).toHaveBeenCalledWith('user-id');
      expect(tokenService.signRefresh).toHaveBeenCalledWith('user-id');
      expect(logs).toEqual([
        'Login succeeded, method=password, userId=user-id',
      ]);
      expectLogsWithout('access.jwt', 'refresh.jwt');
    });

    it('signs nothing when the credentials are wrong', async () => {
      passwordService.verify.mockResolvedValue(false);

      await expect(service.login(dto, ip)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(tokenService.signAccess).not.toHaveBeenCalled();
      expect(tokenService.signRefresh).not.toHaveBeenCalled();
    });

    it.each(['signAccess', 'signRefresh'] as const)(
      'returns 503 when %s fails, and logs no token or secret',
      async (method) => {
        tokenService[method].mockImplementation(() => {
          throw new Error('secretOrPrivateKey must have a value');
        });

        const error: unknown = await service
          .login(dto, ip)
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect((error as ServiceUnavailableException).getResponse()).toEqual({
          code: ErrorCode.SERVICE_UNAVAILABLE,
          message: 'Login is temporarily unavailable',
        });
        expectLogsWithout('access.jwt', 'secretOrPrivateKey');
      },
    );

    describe('with the email step enabled', () => {
      const confirmUrl = 'http://localhost:3000/login/confirm';
      let method: LoginChallengeMethod;

      beforeEach(() => {
        method = LoginChallengeMethod.OTP;
        config.get.mockImplementation(
          (key: string) =>
            ({
              LOGIN_EMAIL_CONFIRMATION_ENABLED: true,
              LOGIN_EMAIL_CONFIRMATION_METHOD: method,
              LOGIN_CONFIRM_URL: confirmUrl,
            })[key],
        );
        usersService.findByIdForUpdate.mockResolvedValue(activeUser);
      });

      const previous = {
        id: 'old-attempt-id',
        userId: 'user-id',
        method: LoginChallengeMethod.OTP,
      };

      /** The error the service throws, to check its response object. */
      const loginError = async () =>
        (await service
          .login(dto, ip)
          .catch((e: unknown) => e)) as HttpException;

      it('returns the 202 body and issues no tokens', async () => {
        await expect(service.login(dto, ip)).resolves.toEqual({
          confirmationRequired: true,
          method: LoginChallengeMethod.OTP,
          attemptId: 'login-attempt-id',
          expiresInSeconds: 600,
          resendAfterSeconds: 60,
        });
        expect(tokenService.signAccess).not.toHaveBeenCalled();
        expect(tokenService.signRefresh).not.toHaveBeenCalled();
        expect(limiter.reset).toHaveBeenCalled();
      });

      it('creates the attempt with the method from the config', async () => {
        await service.login(dto, ip);

        expect(loginChallengeService.create).toHaveBeenCalledWith(
          'user-id',
          LoginChallengeMethod.OTP,
        );
      });

      it('sends the OTP by email after the attempt is created, and logs no secret', async () => {
        await service.login(dto, ip);

        expect(mailService.sendLoginOtp).toHaveBeenCalledWith(
          dto.email,
          '654321',
        );
        expect(
          loginChallengeService.create.mock.invocationCallOrder[0],
        ).toBeLessThan(mailService.sendLoginOtp.mock.invocationCallOrder[0]);
        expectLogsWithout('654321');
        expect(logs).toContain(
          'Login email sent, method=otp, attemptId=login-attempt-id, ' +
            'userId=user-id',
        );
      });

      it('sends a magic link with attemptId.secret in the fragment', async () => {
        method = LoginChallengeMethod.MAGIC_LINK;
        loginChallengeService.create.mockResolvedValue({
          challenge: {
            id: 'login-attempt-id',
            userId: 'user-id',
            method: LoginChallengeMethod.MAGIC_LINK,
          },
          secret: 'magic-secret',
        });

        await service.login(dto, ip);

        expect(mailService.sendLoginMagicLink).toHaveBeenCalledWith(
          dto.email,
          `${confirmUrl}#login-attempt-id.magic-secret`,
        );
        expectLogsWithout('magic-secret');
      });

      it('locks the user before the previous attempt', async () => {
        await service.login(dto, ip);

        expect(usersService.findByIdForUpdate).toHaveBeenCalledWith('user-id');
        expect(
          usersService.findByIdForUpdate.mock.invocationCallOrder[0],
        ).toBeLessThan(
          loginChallengeService.findActiveForUserForUpdate.mock
            .invocationCallOrder[0],
        );
      });

      it('replaces a previous attempt after the 60-second pause', async () => {
        loginChallengeService.findActiveForUser.mockResolvedValue(previous);
        loginChallengeService.findActiveForUserForUpdate.mockResolvedValue(
          previous,
        );

        await service.login(dto, ip);

        expect(loginChallengeService.consume).toHaveBeenCalledWith(
          previous,
          LoginChallengeConsumedReason.REPLACED,
        );
        expect(
          loginChallengeService.consume.mock.invocationCallOrder[0],
        ).toBeLessThan(
          loginChallengeService.create.mock.invocationCallOrder[0],
        );
      });

      it('answers 429 with the remaining seconds before the transaction', async () => {
        loginChallengeService.findActiveForUser.mockResolvedValue(previous);
        loginChallengeService.secondsUntilResend.mockReturnValue(42);

        const error = await loginError();

        expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect(error.getResponse()).toMatchObject({
          code: ErrorCode.RATE_LIMIT_EXCEEDED,
          details: { retryAfterSeconds: 42 },
        });
        expect(usersService.findByIdForUpdate).not.toHaveBeenCalled();
        expect(loginChallengeService.create).not.toHaveBeenCalled();
        expect(mailService.sendLoginOtp).not.toHaveBeenCalled();
        // The method of the saved attempt, as in every challenge event.
        expect(logs).toContain(
          `Login attempt rejected, reason=too_soon, method=${previous.method}, ` +
            `attemptId=${previous.id}, userId=${previous.userId}, ` +
            'retryAfterSeconds=42',
        );
      });

      it('rechecks the pause under the lock (a parallel login just sent one)', async () => {
        loginChallengeService.findActiveForUserForUpdate.mockResolvedValue(
          previous,
        );
        loginChallengeService.secondsUntilResend.mockReturnValue(60);

        const error = await loginError();

        expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect(loginChallengeService.consume).not.toHaveBeenCalled();
        expect(loginChallengeService.create).not.toHaveBeenCalled();
        expect(mailService.sendLoginOtp).not.toHaveBeenCalled();
      });

      it.each([UserStatus.BLOCKED, UserStatus.DELETING, UserStatus.DELETED])(
        'answers the neutral 401 without an email when the user became %s',
        async (status) => {
          usersService.findByIdForUpdate.mockResolvedValue({
            ...activeUser,
            status,
          });

          const error = await loginError();

          expect(error).toBeInstanceOf(UnauthorizedException);
          expect(error.getResponse()).toEqual({
            code: ErrorCode.INVALID_CREDENTIALS,
            message: INVALID_CREDENTIALS_MESSAGE,
          });
          expect(loginChallengeService.create).not.toHaveBeenCalled();
          expect(mailService.sendLoginOtp).not.toHaveBeenCalled();
        },
      );

      it('answers 503 without an email when the attempt is not committed', async () => {
        loginChallengeService.create.mockRejectedValue(new Error('db down'));

        const error = await loginError();

        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect(mailService.sendLoginOtp).not.toHaveBeenCalled();
      });

      it('answers 503 with the attempt fields, but no secret, when SMTP fails', async () => {
        mailService.sendLoginOtp.mockRejectedValue(
          Object.assign(new Error(`550 <${dto.email}>: Recipient rejected`), {
            code: 'EENVELOPE',
          }),
        );

        const error = await loginError();

        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect(error.getResponse()).toEqual({
          code: ErrorCode.SERVICE_UNAVAILABLE,
          message: 'Confirmation email could not be sent',
          details: {
            confirmationRequired: true,
            method: LoginChallengeMethod.OTP,
            attemptId: 'login-attempt-id',
            retryAfterSeconds: 60,
          },
        });
        expect(JSON.stringify(error.getResponse())).not.toContain('654321');
        // The SMTP message quotes the address: only the code is logged.
        expect(logs).toContain(
          'Login email failed, method=otp, attemptId=login-attempt-id, ' +
            'userId=user-id: EENVELOPE',
        );
        expectLogsWithout('654321', 'Recipient rejected');
      });
    });

    describe('failed-attempt limit', () => {
      it('reserves a slot for the email and IP before the hash check', async () => {
        await service.login(dto, ip);

        expect(limiter.reserve).toHaveBeenCalledWith(dto.email, ip);
        expect(limiter.reserve.mock.invocationCallOrder[0]).toBeLessThan(
          passwordService.verify.mock.invocationCallOrder[0],
        );
      });

      it('resets the pair after a successful login', async () => {
        await service.login(dto, ip);

        expect(limiter.reset).toHaveBeenCalledWith({ key: 'slot', at: 1 });
        expect(limiter.release).not.toHaveBeenCalled();
      });

      it('keeps the slot as a failure after a wrong login', async () => {
        passwordService.verify.mockResolvedValue(false);

        await expect(service.login(dto, ip)).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
        expect(limiter.reset).not.toHaveBeenCalled();
        expect(limiter.release).not.toHaveBeenCalled();
      });

      it('gives the slot back and answers 503 when the database fails', async () => {
        usersService.findByEmail.mockRejectedValue(
          new Error('connect ECONNREFUSED 10.0.0.5:5432'),
        );

        const error: unknown = await service
          .login(dto, ip)
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect((error as ServiceUnavailableException).getResponse()).toEqual({
          code: ErrorCode.SERVICE_UNAVAILABLE,
          message: 'Login is temporarily unavailable',
        });
        expect(limiter.release).toHaveBeenCalledWith({ key: 'slot', at: 1 });
        // The error name only: the message can describe the infrastructure.
        expect(logs).toEqual(['Login failed, reason=database: Error']);
      });

      it('checks no password when the pair is over the limit', async () => {
        const tooMany = new HttpException('Too many', 429);
        limiter.reserve.mockImplementation(() => {
          throw tooMany;
        });

        await expect(service.login(dto, ip)).rejects.toBe(tooMany);
        expect(usersService.findByEmail).not.toHaveBeenCalled();
        expect(passwordService.verify).not.toHaveBeenCalled();
        expect(passwordService.verifyDummy).not.toHaveBeenCalled();
        expect(logs).toEqual([
          `Login rejected, reason=failure_limit, emailId=${EMAIL_ID}`,
        ]);
        expectLogsWithout();
      });
    });
  });

  describe('logout', () => {
    it('names the user from a valid access token', () => {
      tokenService.verifyAccess.mockReturnValue({
        ok: true,
        userId: 'user-id',
      });

      service.logout('access.jwt');

      expect(tokenService.verifyAccess).toHaveBeenCalledWith('access.jwt');
      expect(logs).toEqual(['Logout, userId=user-id']);
      expectLogsWithout('access.jwt');
    });

    it('still logs, as unknown, without a valid token', () => {
      tokenService.verifyAccess.mockReturnValue({
        ok: false,
        reason: 'missing',
      });

      service.logout(undefined);

      expect(logs).toEqual(['Logout, userId=unknown']);
    });
  });

  describe('confirmLogin', () => {
    const attemptId = '3f1c2b9e-8d4a-4c6b-9e1f-2a7d5c8b0e41';
    const otpDto = { attemptId, code: '654321' };
    const tokenDto = { token: `${attemptId}.magic-secret` };

    const activeUser: User = {
      id: 'user-id',
      email: dto.email,
      passwordHash: hash,
      status: UserStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    let attempt: {
      id: string;
      userId: string;
      method: LoginChallengeMethod;
      attempts: number;
      consumedAt: Date | null;
      consumedReason: LoginChallengeConsumedReason | null;
    };

    beforeEach(() => {
      attempt = {
        id: attemptId,
        userId: 'user-id',
        method: LoginChallengeMethod.OTP,
        attempts: 0,
        consumedAt: null,
        consumedReason: null,
      };
      loginChallengeService.findById.mockImplementation(() =>
        Promise.resolve(attempt),
      );
      loginChallengeService.findByIdForUpdate.mockImplementation(() =>
        Promise.resolve(attempt),
      );
      usersService.findByIdForUpdate.mockResolvedValue(activeUser);
      loginChallengeService.secretMatches.mockReturnValue(true);
    });

    /** The error the service throws, to check its status and body. */
    const confirmError = async (body: object = otpDto) =>
      (await service
        .confirmLogin(body)
        .catch((e: unknown) => e)) as HttpException;

    const expect400 = async (body: object = otpDto) => {
      const error = await confirmError(body);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({
        code: ErrorCode.BAD_REQUEST,
        message: 'Invalid or expired confirmation code or token',
      });
    };

    describe('success', () => {
      it('signs both tokens and consumes the attempt as confirmed', async () => {
        await expect(service.confirmLogin(otpDto)).resolves.toEqual({
          accessToken: 'access.jwt',
          refreshToken: 'refresh.jwt',
        });
        expect(loginChallengeService.secretMatches).toHaveBeenCalledWith(
          attempt,
          '654321',
        );
        expect(loginChallengeService.consume).toHaveBeenCalledWith(
          attempt,
          LoginChallengeConsumedReason.CONFIRMED,
        );
        expect(tokenService.signAccess).toHaveBeenCalledWith('user-id');
      });

      it('signs the tokens before the attempt is consumed', async () => {
        await service.confirmLogin(otpDto);

        expect(
          tokenService.signRefresh.mock.invocationCallOrder[0],
        ).toBeLessThan(
          loginChallengeService.consume.mock.invocationCallOrder[0],
        );
      });

      it('locks the user before the attempt', async () => {
        await service.confirmLogin(otpDto);

        expect(usersService.findByIdForUpdate).toHaveBeenCalledWith('user-id');
        expect(
          usersService.findByIdForUpdate.mock.invocationCallOrder[0],
        ).toBeLessThan(
          loginChallengeService.findByIdForUpdate.mock.invocationCallOrder[0],
        );
      });

      it('confirms a magic link by the attemptId inside the token', async () => {
        attempt.method = LoginChallengeMethod.MAGIC_LINK;
        loginChallengeService.parseMagicLinkToken.mockReturnValue({
          attemptId,
          secret: 'magic-secret',
        });

        await service.confirmLogin(tokenDto);

        expect(loginChallengeService.findById).toHaveBeenCalledWith(attemptId);
        expect(loginChallengeService.secretMatches).toHaveBeenCalledWith(
          attempt,
          'magic-secret',
        );
      });

      it('logs no code, token or secret', async () => {
        await service.confirmLogin(otpDto);
        expectLogsWithout('654321', 'access.jwt', 'refresh.jwt');
      });

      it('logs the saved method with the attempt and the user', async () => {
        await service.confirmLogin(otpDto);

        expect(logs).toContain(
          `Login confirmed, method=otp, attemptId=${attemptId}, userId=user-id`,
        );
      });
    });

    describe('wrong code or link', () => {
      beforeEach(() => {
        loginChallengeService.secretMatches.mockReturnValue(false);
      });

      it('logs the method of the saved attempt', async () => {
        attempt.method = LoginChallengeMethod.MAGIC_LINK;
        loginChallengeService.parseMagicLinkToken.mockReturnValue({
          attemptId,
          secret: 'wrong-secret',
        });

        await expect400(tokenDto);

        expect(logs).toContain(
          'Login confirmation rejected, reason=wrong_secret, ' +
            `method=magic_link, attemptId=${attemptId}, userId=user-id`,
        );
        expectLogsWithout('wrong-secret');
      });

      it('logs the method as unknown when the attempt is not found', async () => {
        loginChallengeService.findById.mockResolvedValue(null);

        await expect400();

        expect(logs).toContainEqual(
          expect.stringContaining(
            'Login confirmation rejected, reason=not_found, method=unknown',
          ),
        );
      });

      it('counts a wrong OTP and answers 400', async () => {
        loginChallengeService.registerWrongOtp.mockResolvedValue({
          ...attempt,
          attempts: 1,
        });

        await expect400();
        expect(loginChallengeService.registerWrongOtp).toHaveBeenCalledWith(
          attempt,
        );
        expect(tokenService.signAccess).not.toHaveBeenCalled();
      });

      it('answers 400 (not 429) for the fifth wrong OTP', async () => {
        loginChallengeService.registerWrongOtp.mockResolvedValue({
          ...attempt,
          attempts: 5,
          consumedAt: new Date(),
          consumedReason: LoginChallengeConsumedReason.ATTEMPTS_EXHAUSTED,
        });

        await expect400();
      });

      it('answers 400 for a wrong link without counting it', async () => {
        attempt.method = LoginChallengeMethod.MAGIC_LINK;
        loginChallengeService.parseMagicLinkToken.mockReturnValue({
          attemptId,
          secret: 'wrong',
        });

        await expect400(tokenDto);
        expect(loginChallengeService.registerWrongOtp).not.toHaveBeenCalled();
      });
    });

    describe('rejected before the comparison', () => {
      it('answers 400 for a token that is not attemptId.secret, without a query', async () => {
        await expect400({ token: 'garbage' });
        expect(loginChallengeService.findById).not.toHaveBeenCalled();
      });

      it('answers 400 for an unknown attempt', async () => {
        loginChallengeService.findById.mockResolvedValue(null);

        await expect400();
        expect(usersService.findByIdForUpdate).not.toHaveBeenCalled();
      });

      it('answers 400 for a code sent to a magic link attempt', async () => {
        attempt.method = LoginChallengeMethod.MAGIC_LINK;

        await expect400();
        expect(loginChallengeService.secretMatches).not.toHaveBeenCalled();
      });

      it.each([
        LoginChallengeConsumedReason.CONFIRMED,
        LoginChallengeConsumedReason.REPLACED,
        LoginChallengeConsumedReason.USER_INACTIVE,
      ])('answers 400 for an attempt consumed as %s', async (reason) => {
        attempt.consumedAt = new Date();
        attempt.consumedReason = reason;

        await expect400();
        expect(loginChallengeService.secretMatches).not.toHaveBeenCalled();
      });

      it('answers 429 after five wrong codes, even for the correct code', async () => {
        attempt.attempts = 5;
        attempt.consumedAt = new Date();
        attempt.consumedReason =
          LoginChallengeConsumedReason.ATTEMPTS_EXHAUSTED;

        const error = await confirmError();

        expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect(error.getResponse()).toMatchObject({
          code: ErrorCode.RATE_LIMIT_EXCEEDED,
        });
        expect(tokenService.signAccess).not.toHaveBeenCalled();
      });

      it('answers 400 for an expired attempt without counting it', async () => {
        loginChallengeService.isExpired.mockReturnValue(true);
        loginChallengeService.secretMatches.mockReturnValue(false);

        await expect400();
        expect(loginChallengeService.registerWrongOtp).not.toHaveBeenCalled();
      });
    });

    describe('user is no longer active', () => {
      it.each([
        UserStatus.PENDING,
        UserStatus.BLOCKED,
        UserStatus.DELETING,
        UserStatus.DELETED,
      ])(
        'consumes the attempt as user_inactive and answers the login 401 for %s',
        async (status) => {
          usersService.findByIdForUpdate.mockResolvedValue({
            ...activeUser,
            status,
          });

          const error = await confirmError();

          expect(error).toBeInstanceOf(UnauthorizedException);
          expect(error.getResponse()).toEqual({
            code: ErrorCode.INVALID_CREDENTIALS,
            message: INVALID_CREDENTIALS_MESSAGE,
          });
          expect(loginChallengeService.consume).toHaveBeenCalledWith(
            attempt,
            LoginChallengeConsumedReason.USER_INACTIVE,
          );
          expect(tokenService.signAccess).not.toHaveBeenCalled();
        },
      );

      it('does the same when the user is gone', async () => {
        usersService.findByIdForUpdate.mockResolvedValue(null);

        await expect(service.confirmLogin(otpDto)).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
        expect(loginChallengeService.consume).toHaveBeenCalledWith(
          attempt,
          LoginChallengeConsumedReason.USER_INACTIVE,
        );
      });
    });

    describe('failures', () => {
      it('answers 503 and does not consume the attempt when signing fails', async () => {
        tokenService.signAccess.mockImplementation(() => {
          throw new Error('bad key');
        });

        const error = await confirmError();

        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect(loginChallengeService.consume).not.toHaveBeenCalled();
      });

      it('answers 503 when the database fails', async () => {
        loginChallengeService.findById.mockRejectedValue(new Error('db down'));

        const error = await confirmError();

        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect(error.getResponse()).toEqual({
          code: ErrorCode.SERVICE_UNAVAILABLE,
          message: 'Login is temporarily unavailable',
        });
      });
    });
  });

  describe('resendLogin', () => {
    const attemptId = '3f1c2b9e-8d4a-4c6b-9e1f-2a7d5c8b0e41';
    const resendDto = { attemptId };

    const activeUser: User = {
      id: 'user-id',
      email: dto.email,
      passwordHash: hash,
      status: UserStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    let attempt: {
      id: string;
      userId: string;
      method: LoginChallengeMethod;
      attempts: number;
      consumedAt: Date | null;
      consumedReason: LoginChallengeConsumedReason | null;
    };

    beforeEach(() => {
      attempt = {
        id: attemptId,
        userId: 'user-id',
        method: LoginChallengeMethod.OTP,
        attempts: 3,
        consumedAt: null,
        consumedReason: null,
      };
      loginChallengeService.findById.mockImplementation(() =>
        Promise.resolve(attempt),
      );
      loginChallengeService.findByIdForUpdate.mockImplementation(() =>
        Promise.resolve(attempt),
      );
      loginChallengeService.rotateSecret.mockImplementation(() =>
        Promise.resolve({
          challenge: { ...attempt, attempts: 0 },
          secret: '777888',
        }),
      );
      usersService.findByIdForUpdate.mockResolvedValue(activeUser);
    });

    const resendError = async () =>
      (await service
        .resendLogin(resendDto)
        .catch((e: unknown) => e)) as HttpException;

    describe('success', () => {
      it('returns the 202 body with the same attemptId', async () => {
        await expect(service.resendLogin(resendDto)).resolves.toEqual({
          method: LoginChallengeMethod.OTP,
          attemptId,
          expiresInSeconds: 600,
          resendAfterSeconds: 60,
        });
        expect(loginChallengeService.rotateSecret).toHaveBeenCalledWith(
          attempt,
        );
        expect(loginChallengeService.create).not.toHaveBeenCalled();
      });

      it('locks the user before the attempt', async () => {
        await service.resendLogin(resendDto);

        expect(
          usersService.findByIdForUpdate.mock.invocationCallOrder[0],
        ).toBeLessThan(
          loginChallengeService.findByIdForUpdate.mock.invocationCallOrder[0],
        );
      });

      it('sends the new OTP to the user after the new secret is saved, logging no secret', async () => {
        await service.resendLogin(resendDto);

        expect(mailService.sendLoginOtp).toHaveBeenCalledWith(
          dto.email,
          '777888',
        );
        expect(
          loginChallengeService.rotateSecret.mock.invocationCallOrder[0],
        ).toBeLessThan(mailService.sendLoginOtp.mock.invocationCallOrder[0]);
        expectLogsWithout('777888');
        expect(logs).toContain(
          `Login email sent, method=otp, attemptId=${attemptId}, userId=user-id`,
        );
      });

      it('keeps the method of the attempt, whatever the config says', async () => {
        attempt.method = LoginChallengeMethod.MAGIC_LINK;
        config.get.mockImplementation((key: string) =>
          key === 'LOGIN_CONFIRM_URL'
            ? 'http://localhost:3000/login/confirm'
            : 'otp',
        );

        await service.resendLogin(resendDto);

        expect(mailService.sendLoginMagicLink).toHaveBeenCalledWith(
          dto.email,
          `http://localhost:3000/login/confirm#${attemptId}.777888`,
        );
        expect(mailService.sendLoginOtp).not.toHaveBeenCalled();
      });

      it('resends an expired attempt (the TTL does not block a resend)', async () => {
        loginChallengeService.isExpired.mockReturnValue(true);

        await expect(service.resendLogin(resendDto)).resolves.toMatchObject({
          attemptId,
        });
      });
    });

    describe('rejected', () => {
      it('answers 400 for an unknown attempt', async () => {
        loginChallengeService.findById.mockResolvedValue(null);

        const error = await resendError();

        expect(error).toBeInstanceOf(BadRequestException);
        expect(usersService.findByIdForUpdate).not.toHaveBeenCalled();
      });

      it.each([
        LoginChallengeConsumedReason.CONFIRMED,
        LoginChallengeConsumedReason.REPLACED,
        LoginChallengeConsumedReason.USER_INACTIVE,
      ])('answers 400 for an attempt consumed as %s', async (reason) => {
        attempt.consumedAt = new Date();
        attempt.consumedReason = reason;

        expect(await resendError()).toBeInstanceOf(BadRequestException);
        expect(loginChallengeService.rotateSecret).not.toHaveBeenCalled();
      });

      it('answers 429 for an attempt exhausted by five wrong codes', async () => {
        attempt.consumedAt = new Date();
        attempt.consumedReason =
          LoginChallengeConsumedReason.ATTEMPTS_EXHAUSTED;

        const error = await resendError();

        expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect(loginChallengeService.rotateSecret).not.toHaveBeenCalled();
        expect(logs).toContain(
          'Login resend rejected, reason=attempts_exhausted, method=otp, ' +
            `attemptId=${attemptId}, userId=user-id`,
        );
      });

      it('answers 429 with the remaining seconds within 60 seconds', async () => {
        loginChallengeService.secondsUntilResend.mockReturnValue(17);

        const error = await resendError();

        expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        expect(error.getResponse()).toMatchObject({
          code: ErrorCode.RATE_LIMIT_EXCEEDED,
          details: { retryAfterSeconds: 17 },
        });
        expect(loginChallengeService.rotateSecret).not.toHaveBeenCalled();
        expect(mailService.sendLoginOtp).not.toHaveBeenCalled();
      });

      it.each([UserStatus.BLOCKED, UserStatus.DELETING, UserStatus.DELETED])(
        'consumes the attempt as user_inactive and answers 401 for %s',
        async (status) => {
          usersService.findByIdForUpdate.mockResolvedValue({
            ...activeUser,
            status,
          });

          const error = await resendError();

          expect(error).toBeInstanceOf(UnauthorizedException);
          expect(loginChallengeService.consume).toHaveBeenCalledWith(
            attempt,
            LoginChallengeConsumedReason.USER_INACTIVE,
          );
          expect(mailService.sendLoginOtp).not.toHaveBeenCalled();
        },
      );
    });

    describe('failures', () => {
      it('answers 503 when the database fails, without an email', async () => {
        loginChallengeService.rotateSecret.mockRejectedValue(
          new Error('db down'),
        );

        expect(await resendError()).toBeInstanceOf(ServiceUnavailableException);
        expect(mailService.sendLoginOtp).not.toHaveBeenCalled();
      });

      it('answers 503 when SMTP fails, without the secret', async () => {
        mailService.sendLoginOtp.mockRejectedValue(new Error('ECONNREFUSED'));

        const error = await resendError();

        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect(JSON.stringify(error.getResponse())).not.toContain('777888');
      });
    });
  });

  describe('refresh', () => {
    const oldToken = 'old.refresh.jwt';
    const refresh = () => service.refresh(oldToken);

    const refreshError = async (): Promise<HttpException> => {
      try {
        await refresh();
      } catch (error) {
        return error as HttpException;
      }
      throw new Error('expected refresh to fail');
    };

    const expectInvalidSession = (error: HttpException) => {
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error.getResponse()).toEqual({
        code: ErrorCode.INVALID_SESSION,
        message: INVALID_SESSION_MESSAGE,
      });
      expect(tokenService.signAccess).not.toHaveBeenCalled();
      expect(tokenService.signRefresh).not.toHaveBeenCalled();
    };

    beforeEach(() => {
      tokenService.verifyRefresh.mockReturnValue({
        ok: true,
        userId: 'user-id',
      });
      usersService.findStatusById.mockResolvedValue({
        id: 'user-id',
        status: UserStatus.ACTIVE,
      });
    });

    it('returns a new pair for an active user', async () => {
      await expect(refresh()).resolves.toEqual({
        accessToken: 'access.jwt',
        refreshToken: 'refresh.jwt',
      });
      expect(tokenService.verifyRefresh).toHaveBeenCalledWith(oldToken);
      expect(usersService.findStatusById).toHaveBeenCalledWith('user-id');
      expect(tokenService.signAccess).toHaveBeenCalledWith('user-id');
      expect(tokenService.signRefresh).toHaveBeenCalledWith('user-id');
      expectLogsWithout(oldToken, 'access.jwt', 'refresh.jwt');
    });

    it.each(Object.values(TokenFailure))(
      'answers 401 invalid_session for a %s token, without a database query',
      async (reason) => {
        tokenService.verifyRefresh.mockReturnValue({ ok: false, reason });

        expectInvalidSession(await refreshError());
        expect(usersService.findStatusById).not.toHaveBeenCalled();
        expect(logs.some((line) => line.includes(`reason=${reason}`))).toBe(
          true,
        );
        expectLogsWithout(oldToken);
      },
    );

    it('answers 401 invalid_session when the user no longer exists', async () => {
      usersService.findStatusById.mockResolvedValue(null);

      expectInvalidSession(await refreshError());
    });

    it.each([
      UserStatus.PENDING,
      UserStatus.BLOCKED,
      UserStatus.DELETING,
      UserStatus.DELETED,
    ])('answers 401 invalid_session for a %s user', async (status) => {
      usersService.findStatusById.mockResolvedValue({ id: 'user-id', status });

      expectInvalidSession(await refreshError());
    });

    it('answers 503, not 401, when the database fails', async () => {
      usersService.findStatusById.mockRejectedValue(new Error('db down'));

      const error = await refreshError();

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(error.getResponse()).toMatchObject({
        code: ErrorCode.SERVICE_UNAVAILABLE,
      });
      expect(tokenService.signAccess).not.toHaveBeenCalled();
    });

    it('answers 503 when signing fails', async () => {
      tokenService.signRefresh.mockImplementation(() => {
        throw new Error('sign failed');
      });

      expect(await refreshError()).toBeInstanceOf(ServiceUnavailableException);
    });
  });
});
