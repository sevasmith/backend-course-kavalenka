import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { FastifyReply } from 'fastify';
import { UserStatus } from '@/modules/users/user.types';
import { AuthController } from '../auth/auth.controller';
import { AuthService } from './auth.service';
import { RegistrationChallengeMethod } from './registration-challenge.types';

describe('AuthController', () => {
  const dto = { email: 'user@example.com', password: 'secret12' };

  let controller: AuthController;
  let authService: { register: jest.Mock };
  let reply: { status: jest.Mock };

  beforeEach(async () => {
    authService = { register: jest.fn() };
    reply = { status: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

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
});
