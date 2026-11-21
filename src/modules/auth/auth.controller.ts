import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  LoginThrottle,
  RegistrationThrottle,
} from '@/core/throttler/throttler.decorators';
import { Public } from '@/modules/rbac/rbac.decorators';
import { RegisterDto } from './dto/register.dto';
import { ConfirmRegistrationDto } from './dto/confirm-registration.dto';
import { ResendRegistrationDto } from './dto/resend-registration.dto';
import { LoginDto } from './dto/login.dto';
import { setAuthCookies } from './auth-cookies';
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

  /**
   * Direct login: 204 with the `access_token` and `refresh_token` cookies and
   * no body. The tokens are never in the body, so JavaScript can't read them.
   * 401 `invalid_credentials` for any wrong login, 503 (no cookies) if
   * signing fails. 429 over 30 requests per IP per minute, or after 5 failed
   * logins for the same email from the same IP within 15 minutes.
   */
  @Post('login')
  @Public()
  @LoginThrottle()
  @HttpCode(HttpStatus.NO_CONTENT)
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const { accessToken, refreshToken } = await this.authService.login(dto, ip);
    setAuthCookies(reply, accessToken, refreshToken);
  }
}
