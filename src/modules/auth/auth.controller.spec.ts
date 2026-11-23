import {
  BadRequestException,
  HttpStatus,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { UserStatus } from '@/modules/users/user.types';
import { AuthController } from '../auth/auth.controller';
import { AuthService } from './auth.service';
import { ConfigService } from '@/core/config/config.service';
import {
  isLoginThrottled,
  isRegistrationThrottled,
} from '@/core/throttler/throttler.decorators';
import type { ExecutionContext } from '@nestjs/common';
import { RegistrationChallengeMethod } from './registration-challenge.types';
import { REFRESH_TOKEN_COOKIE } from './auth-cookies';
import { ACCESS_TOKEN_COOKIE } from '@/core/http/openapi';
import { IS_PUBLIC_KEY } from '@/modules/rbac/rbac.decorators';

describe('AuthController', () => {
  const dto = { email: 'user@example.com', password: 'secret12' };

  let controller: AuthController;
  let authService: {
    register: jest.Mock;
    confirmRegistration: jest.Mock;
    resendRegistration: jest.Mock;
    login: jest.Mock;
    confirmLogin: jest.Mock;
    resendLogin: jest.Mock;
    refresh: jest.Mock;
    logout: jest.Mock;
  };
  let reply: {
    status: jest.Mock;
    setCookie: jest.Mock;
    clearCookie: jest.Mock;
  };

  beforeEach(async () => {
    authService = {
      register: jest.fn(),
      confirmRegistration: jest.fn(),
      resendRegistration: jest.fn(),
      login: jest.fn(),
      confirmLogin: jest.fn(),
      resendLogin: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
    };
    reply = {
      status: jest.fn(),
      setCookie: jest.fn(),
      clearCookie: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: ConfigService, useValue: { get: () => 'strict' } },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  // The method function itself: decorators store their metadata on it.
  const handler = (method: keyof AuthController): object =>
    Reflect.get(AuthController.prototype, method);

  const register = () =>
    controller.register(dto, reply as unknown as FastifyReply);

  it('keeps the default 201 when the account is active', async () => {
    const result = {
      id: 'user-id',
      email: dto.email,
      status: UserStatus.ACTIVE,
    };
    authService.register.mockResolvedValue(result);

    await expect(register()).resolves.toEqual(result);
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('returns 202 when email confirmation is required', async () => {
    const result = {
      confirmationRequired: true,
      method: RegistrationChallengeMethod.OTP,
      attemptId: 'attempt-id',
      expiresInSeconds: 600,
      resendAfterSeconds: 60,
    };
    authService.register.mockResolvedValue(result);

    await expect(register()).resolves.toEqual(result);
    expect(reply.status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
  });

  describe('confirmRegistration', () => {
    const confirmDto = { token: 'token' };

    it('passes the 400 from the service through', async () => {
      authService.confirmRegistration.mockRejectedValue(
        new BadRequestException(),
      );

      await expect(
        controller.confirmRegistration(confirmDto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns the active profile from the service', async () => {
      const result = {
        id: 'user-id',
        email: dto.email,
        status: UserStatus.ACTIVE,
      };
      authService.confirmRegistration.mockResolvedValue(result);

      await expect(controller.confirmRegistration(confirmDto)).resolves.toEqual(
        result,
      );
    });
  });

  describe('resendRegistration', () => {
    it('answers 202 with the body from the service', async () => {
      const result = {
        confirmationRequired: true,
        method: RegistrationChallengeMethod.OTP,
        attemptId: 'new-attempt-id',
        expiresInSeconds: 600,
        resendAfterSeconds: 60,
      };
      authService.resendRegistration.mockResolvedValue(result);

      await expect(
        controller.resendRegistration({ email: dto.email }),
      ).resolves.toEqual(result);
      expect(
        Reflect.getMetadata(HTTP_CODE_METADATA, handler('resendRegistration')),
      ).toBe(HttpStatus.ACCEPTED);
    });
  });

  describe('registration rate limit', () => {
    const contextFor = (method: keyof AuthController) =>
      ({ getHandler: () => handler(method) }) as unknown as ExecutionContext;

    it.each(['register', 'resendRegistration'] as const)(
      'applies to %s',
      (method) => {
        expect(isRegistrationThrottled(contextFor(method))).toBe(true);
      },
    );

    it('does not apply to confirmRegistration', () => {
      expect(isRegistrationThrottled(contextFor('confirmRegistration'))).toBe(
        false,
      );
    });
  });

  describe('login', () => {
    const ip = '203.0.113.7';
    const login = () =>
      controller.login(dto, ip, reply as unknown as FastifyReply);

    it('answers 204 and sets both cookies, with no body', async () => {
      authService.login.mockResolvedValue({
        accessToken: 'access.jwt',
        refreshToken: 'refresh.jwt',
      });

      await expect(login()).resolves.toBeUndefined();
      expect(authService.login).toHaveBeenCalledWith(dto, ip);
      expect(reply.setCookie).toHaveBeenCalledWith(
        ACCESS_TOKEN_COOKIE,
        'access.jwt',
        expect.any(Object),
      );
      expect(reply.setCookie).toHaveBeenCalledWith(
        REFRESH_TOKEN_COOKIE,
        'refresh.jwt',
        expect.any(Object),
      );
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler('login'))).toBe(
        HttpStatus.NO_CONTENT,
      );
    });

    it('answers 202 with the attempt and sets no cookies when the email step is on', async () => {
      const result = {
        confirmationRequired: true,
        method: 'otp',
        attemptId: 'attempt-id',
        expiresInSeconds: 600,
        resendAfterSeconds: 60,
      };
      authService.login.mockResolvedValue(result);

      await expect(login()).resolves.toBe(result);
      expect(reply.status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
      expect(reply.setCookie).not.toHaveBeenCalled();
    });

    it('is public: a guest has no access token yet', () => {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler('login'))).toBe(true);
    });

    it.each([new UnauthorizedException(), new ServiceUnavailableException()])(
      'sets no cookies when the service throws %p',
      async (error) => {
        authService.login.mockRejectedValue(error);

        await expect(login()).rejects.toBe(error);
        expect(reply.setCookie).not.toHaveBeenCalled();
      },
    );
  });

  describe('confirmLogin', () => {
    const body = {
      attemptId: '3f1c2b9e-8d4a-4c6b-9e1f-2a7d5c8b0e41',
      code: '123456',
    };
    const confirm = () =>
      controller.confirmLogin(body, reply as unknown as FastifyReply);

    it('answers 204 and sets both cookies, with no body', async () => {
      authService.confirmLogin.mockResolvedValue({
        accessToken: 'access.jwt',
        refreshToken: 'refresh.jwt',
      });

      await expect(confirm()).resolves.toBeUndefined();
      expect(authService.confirmLogin).toHaveBeenCalledWith(body);
      expect(reply.setCookie).toHaveBeenCalledWith(
        ACCESS_TOKEN_COOKIE,
        'access.jwt',
        expect.any(Object),
      );
      expect(reply.setCookie).toHaveBeenCalledWith(
        REFRESH_TOKEN_COOKIE,
        'refresh.jwt',
        expect.any(Object),
      );
      expect(
        Reflect.getMetadata(HTTP_CODE_METADATA, handler('confirmLogin')),
      ).toBe(HttpStatus.NO_CONTENT);
    });

    it('is public: the user has no session yet', () => {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler('confirmLogin'))).toBe(
        true,
      );
    });

    it.each([
      new BadRequestException(),
      new UnauthorizedException(),
      new ServiceUnavailableException(),
    ])('sets no cookies when the service throws %p', async (error) => {
      authService.confirmLogin.mockRejectedValue(error);

      await expect(confirm()).rejects.toBe(error);
      expect(reply.setCookie).not.toHaveBeenCalled();
    });
  });

  describe('resendLogin', () => {
    const body = { attemptId: '3f1c2b9e-8d4a-4c6b-9e1f-2a7d5c8b0e41' };

    it('answers 202 with the service result and sets no cookies', async () => {
      const result = {
        method: 'otp',
        attemptId: body.attemptId,
        expiresInSeconds: 600,
        resendAfterSeconds: 60,
      };
      authService.resendLogin.mockResolvedValue(result);

      await expect(controller.resendLogin(body)).resolves.toBe(result);
      expect(authService.resendLogin).toHaveBeenCalledWith(body);
      expect(
        Reflect.getMetadata(HTTP_CODE_METADATA, handler('resendLogin')),
      ).toBe(HttpStatus.ACCEPTED);
      expect(reply.setCookie).not.toHaveBeenCalled();
    });

    it('is public: the user has no session yet', () => {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler('resendLogin'))).toBe(
        true,
      );
    });
  });

  describe('refresh', () => {
    const requestWith = (cookies: Record<string, string>) =>
      ({
        cookies,
        body: { refreshToken: 'from.body' },
      }) as unknown as Parameters<AuthController['refresh']>[0];
    const refresh = (cookies: Record<string, string> = {}) =>
      controller.refresh(
        requestWith(cookies),
        reply as unknown as FastifyReply,
      );

    it('answers 204 and sets the new pair, reading only the cookie', async () => {
      authService.refresh.mockResolvedValue({
        accessToken: 'new.access',
        refreshToken: 'new.refresh',
      });

      await expect(
        refresh({ [REFRESH_TOKEN_COOKIE]: 'old.refresh' }),
      ).resolves.toBeUndefined();

      expect(authService.refresh).toHaveBeenCalledWith('old.refresh');
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler('refresh'))).toBe(
        HttpStatus.NO_CONTENT,
      );
      expect(reply.setCookie).toHaveBeenCalledWith(
        ACCESS_TOKEN_COOKIE,
        'new.access',
        expect.anything(),
      );
      expect(reply.setCookie).toHaveBeenCalledWith(
        REFRESH_TOKEN_COOKIE,
        'new.refresh',
        expect.anything(),
      );
    });

    it('passes undefined without the cookie (a token in the body is ignored)', async () => {
      authService.refresh.mockRejectedValue(new UnauthorizedException());

      await expect(refresh()).rejects.toBeInstanceOf(UnauthorizedException);
      expect(authService.refresh).toHaveBeenCalledWith(undefined);
      expect(reply.setCookie).not.toHaveBeenCalled();
    });

    it('sets no cookies on a 503', async () => {
      authService.refresh.mockRejectedValue(new ServiceUnavailableException());

      await expect(
        refresh({ [REFRESH_TOKEN_COOKIE]: 'old.refresh' }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(reply.setCookie).not.toHaveBeenCalled();
    });

    it('is public: the access token may already be expired', () => {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler('refresh'))).toBe(true);
    });
  });

  describe('logout', () => {
    it('answers 204 and clears both cookies with their original paths', () => {
      const request = { cookies: { [ACCESS_TOKEN_COOKIE]: 'access.jwt' } };

      expect(
        controller.logout(
          request as unknown as FastifyRequest,
          reply as unknown as FastifyReply,
        ),
      ).toBeUndefined();

      // Only for the log; the cookies are cleared whatever it returns.
      expect(authService.logout).toHaveBeenCalledWith('access.jwt');

      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler('logout'))).toBe(
        HttpStatus.NO_CONTENT,
      );
      expect(reply.clearCookie).toHaveBeenCalledWith(
        ACCESS_TOKEN_COOKIE,
        expect.objectContaining({ path: '/' }),
      );
      expect(reply.clearCookie).toHaveBeenCalledWith(
        REFRESH_TOKEN_COOKIE,
        expect.objectContaining({ path: '/auth/refresh' }),
      );
      expect(reply.setCookie).not.toHaveBeenCalled();
    });

    it('is public: it works without a valid token', () => {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler('logout'))).toBe(true);
    });
  });

  describe('login rate limit', () => {
    const contextFor = (method: keyof AuthController) =>
      ({ getHandler: () => handler(method) }) as unknown as ExecutionContext;

    it.each(['login', 'refresh'] as const)('applies to %s', (method) => {
      expect(isLoginThrottled(contextFor(method))).toBe(true);
    });

    it.each(['register', 'confirmRegistration', 'resendRegistration'] as const)(
      'does not apply to %s',
      (method) => {
        expect(isLoginThrottled(contextFor(method))).toBe(false);
      },
    );
  });
});
