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
import { ConfirmLoginDto } from './dto/confirm-login.dto';
import { ResendLoginDto } from './dto/resend-login.dto';
import { setAuthCookies } from './auth-cookies';
import { AuthService } from './auth.service';
import {
  ConfirmRegistrationResult,
  LoginConfirmationRequired,
  LoginResendResult,
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
   *
   * With the email step on: 202 with the attempt (`attemptId`, `method`, ...)
   * and no cookies; 429 with `retryAfterSeconds` if the last email was sent
   * less than 60 seconds ago; 503 with the attempt fields if SMTP fails.
   *
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
  ): Promise<LoginConfirmationRequired | void> {
    const result = await this.authService.login(dto, ip);

    if ('confirmationRequired' in result) {
      reply.status(HttpStatus.ACCEPTED);
      return result;
    }

    setAuthCookies(reply, result.accessToken, result.refreshToken);
  }

  /**
   * Second login step, OTP (`{ attemptId, code }`) or magic link
   * (`{ token }`): 204 with both cookies and no body.
   *
   * 400 for any invalid attempt (unknown, expired, consumed, wrong code or
   * link; the fifth wrong code too), 429 once five wrong codes consumed it,
   * 401 `invalid_credentials` if the user is no longer active, 503 (no
   * cookies) if signing or the database fails.
   */
  @Post('login/confirm')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirmLogin(
    @Body() dto: ConfirmLoginDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const { accessToken, refreshToken } =
      await this.authService.confirmLogin(dto);
    setAuthCookies(reply, accessToken, refreshToken);
  }

  /**
   * New code or link for the same attempt: 202 with `method`, `attemptId`,
   * `expiresInSeconds: 600`, `resendAfterSeconds: 60`. The old secret stops
   * working.
   *
   * 400 for an unknown or consumed attempt, 429 within 60 seconds of the last
   * email (with `retryAfterSeconds`) or after five wrong codes, 401
   * `invalid_credentials` if the user is no longer active, 503 if the
   * database or SMTP fails.
   */
  @Post('login/resend')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  resendLogin(@Body() dto: ResendLoginDto): Promise<LoginResendResult> {
    return this.authService.resendLogin(dto);
  }
}
