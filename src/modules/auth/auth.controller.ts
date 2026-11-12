import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { RegistrationThrottle } from '@/core/throttler/throttler.decorators';
import { Public } from '@/modules/rbac/rbac.decorators';
import { RegisterDto } from './dto/register.dto';
import { ConfirmRegistrationDto } from './dto/confirm-registration.dto';
import { ResendRegistrationDto } from './dto/resend-registration.dto';
import { AuthService } from './auth.service';
import {
  ConfirmRegistrationResult,
  RegisterPendingResult,
  RegisterResult,
} from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * 201 when the account is created active, 202 when it waits for email
   * confirmation. `passthrough` keeps Nest serializing the returned body.
   */
  @Post('register')
  @Public()
  @RegistrationThrottle()
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<RegisterResult | RegisterPendingResult> {
    const result = await this.authService.register(dto);

    if ('confirmationRequired' in result) {
      reply.status(HttpStatus.ACCEPTED);
    }

    return result;
  }

  /**
   * 200 with the safe profile; 400 for any invalid attempt, 429 when the
   * code entry limit is exhausted.
   */
  @Post('register/confirm')
  @Public()
  @HttpCode(HttpStatus.OK)
  confirmRegistration(
    @Body() dto: ConfirmRegistrationDto,
  ): Promise<ConfirmRegistrationResult> {
    return this.authService.confirmRegistration(dto);
  }

  /**
   * 202 with the same body as a pending registration; 400 when there is no
   * pending registration for the email, 429 when asked again within 60 seconds.
   */
  @Post('register/resend')
  @Public()
  @RegistrationThrottle()
  @HttpCode(HttpStatus.ACCEPTED)
  resendRegistration(
    @Body() dto: ResendRegistrationDto,
  ): Promise<RegisterPendingResult> {
    return this.authService.resendRegistration(dto);
  }
}
