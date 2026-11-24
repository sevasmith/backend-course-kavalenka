import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthCookieSameSite } from '@/core/config/config.types';
import { ConfigService } from '@/core/config/config.service';
import {
  LoginThrottle,
  RegistrationThrottle,
} from '@/core/throttler/throttler.decorators';
import { ApiErrorResponse, ApiRateLimitResponse } from '@/core/http/openapi';
import { Public } from '@/modules/rbac/rbac.decorators';
import { RegisterDto } from './dto/register.dto';
import { ConfirmRegistrationDto } from './dto/confirm-registration.dto';
import { ResendRegistrationDto } from './dto/resend-registration.dto';
import { LoginDto } from './dto/login.dto';
import { ConfirmLoginDto } from './dto/confirm-login.dto';
import { ResendLoginDto } from './dto/resend-login.dto';
import {
  ACCESS_TOKEN_COOKIE,
  clearAuthCookies,
  REFRESH_TOKEN_COOKIE,
  setAuthCookies,
} from './auth-cookies';
import { AuthService } from './auth.service';
import {
  ApiAuthCookiesSet,
  ApiAuthPost,
  ApiLoginUnavailableResponse,
} from './auth-api-docs';
import {
  LoginConfirmationRequiredDto,
  LoginResendResultDto,
} from './dto/login-responses.dto';
import {
  RegisterPendingResultDto,
  RegisterResultDto,
} from './dto/registration-responses.dto';
import {
  ConfirmRegistrationResult,
  LoginConfirmationRequired,
  LoginResendResult,
  RegisterPendingResult,
  RegisterResult,
} from './auth.types';

@Controller('auth')
@ApiTags('Auth')
// The global per-IP limit; a route with stricter limits documents its own 429.
@ApiRateLimitResponse()
export class AuthController {
  /** `SameSite` of both auth cookies, the same on set and on clear. */
  private readonly cookieSameSite: AuthCookieSameSite;

  constructor(
    private readonly authService: AuthService,
    configService: ConfigService,
  ) {
    this.cookieSameSite = configService.get('AUTH_COOKIE_SAME_SITE');
  }

  /**
   * 201 when the account is created active, 202 when it waits for email
   * confirmation. `passthrough` keeps Nest serializing the returned body.
   */
  @Post('register')
  @Public()
  @RegistrationThrottle()
  @ApiOperation({
    summary: 'Register with email and password',
    description:
      'Without the email step: 201, the account is `active`. With ' +
      '`REGISTRATION_EMAIL_CONFIRMATION_ENABLED`: 202, the account is ' +
      '`pending` until `POST /auth/register/confirm`.',
  })
  @ApiAuthPost()
  @ApiCreatedResponse({
    type: RegisterResultDto,
    description: 'The account is active (the email step is off).',
  })
  @ApiAcceptedResponse({
    type: RegisterPendingResultDto,
    description:
      'The account is pending and a code or link was sent. The secret is ' +
      'never in the body.',
  })
  @ApiErrorResponse(
    400,
    '`bad_request`: invalid email, or the password does not meet the ' +
      'policy (8-128 characters, a letter and a digit).',
  )
  @ApiErrorResponse(409, '`conflict`: the email is already registered.')
  @ApiRateLimitResponse('too many registrations from this IP.')
  @ApiErrorResponse(
    503,
    '`service_unavailable`: the email could not be sent. The pending ' +
      'account and the attempt are kept: ask for a resend.',
  )
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
  @ApiOperation({
    summary: 'Confirm a registration with the emailed code or link',
    description:
      'Send either `{ attemptId, code }` (OTP) or `{ token }` (magic link), ' +
      'never both. The account becomes `active`.',
  })
  @ApiAuthPost()
  @ApiOkResponse({
    type: RegisterResultDto,
    description: 'The account is active.',
  })
  @ApiErrorResponse(
    400,
    '`bad_request`: the body is invalid, or the code or link is wrong, ' +
      'expired, unknown or already used (the fifth wrong code too).',
  )
  @ApiRateLimitResponse(
    'five wrong codes already used up this attempt; ask for a resend.',
  )
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
  @ApiOperation({
    summary: 'Send a new registration code or link',
    description:
      'Replaces the attempt: the old code or link stops working, and the ' +
      'new attempt has a new `attemptId`.',
  })
  @ApiAuthPost()
  @ApiAcceptedResponse({
    type: RegisterPendingResultDto,
    description: 'A new code or link was sent.',
  })
  @ApiErrorResponse(
    400,
    '`bad_request`: invalid email, or no pending registration for it.',
  )
  @ApiRateLimitResponse(
    'the last email was sent less than 60 seconds ago, or too many ' +
      'requests from this IP.',
  )
  @ApiErrorResponse(
    503,
    '`service_unavailable`: the email could not be sent. The pending ' +
      'account and the attempt are kept: ask for a resend.',
  )
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
  @ApiOperation({
    summary: 'Log in with email and password',
    description:
      'Without the email step: 204 with the auth cookies. With ' +
      '`LOGIN_EMAIL_CONFIRMATION_ENABLED`: 202, a code or link is emailed, ' +
      'and `POST /auth/login/confirm` sets the cookies.',
  })
  @ApiAuthPost()
  @ApiAuthCookiesSet('Logged in (the email step is off).')
  @ApiAcceptedResponse({
    type: LoginConfirmationRequiredDto,
    description:
      'The email step is on: a code or link was sent. No cookies yet; the ' +
      'secret is never in the body.',
  })
  @ApiErrorResponse(400, '`bad_request`: the body is invalid.')
  @ApiErrorResponse(
    401,
    '`invalid_credentials`: unknown email, wrong password or a user that ' +
      'is not `active`. The same body in every case.',
  )
  @ApiRateLimitResponse(
    'over 30 requests per IP per minute, 5 failed logins for this email ' +
      'from this IP within 15 minutes, or an email was already sent less ' +
      'than 60 seconds ago.',
  )
  @ApiLoginUnavailableResponse(
    'the database or token signing failed, or the email could not be ' +
      'sent (then the body has the saved attempt; retry with a resend).',
  )
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

    setAuthCookies(
      reply,
      result.accessToken,
      result.refreshToken,
      this.cookieSameSite,
    );
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
  @ApiOperation({
    summary: 'Confirm a login with the emailed code or link',
    description:
      'Send either `{ attemptId, code }` (OTP) or `{ token }` (magic link), ' +
      'never both. A code or link is valid for 10 minutes.',
  })
  @ApiAuthPost()
  @ApiAuthCookiesSet('Logged in.')
  @ApiErrorResponse(
    400,
    '`bad_request`: the body is invalid, or the attempt is unknown, ' +
      'expired, already used or replaced, or the code or link is wrong ' +
      '(the fifth wrong code too).',
  )
  @ApiErrorResponse(
    401,
    '`invalid_credentials`: the user is no longer `active`.',
  )
  @ApiRateLimitResponse(
    'five wrong codes already used up this attempt; start a new login.',
  )
  @ApiLoginUnavailableResponse('the database or token signing failed.')
  async confirmLogin(
    @Body() dto: ConfirmLoginDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const { accessToken, refreshToken } =
      await this.authService.confirmLogin(dto);
    setAuthCookies(reply, accessToken, refreshToken, this.cookieSameSite);
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
  @ApiOperation({
    summary: 'Send a new login code or link',
    description:
      'Replaces the secret of the same attempt (the old one stops working), ' +
      'restarts the 10 minutes and resets the code counter.',
  })
  @ApiAuthPost()
  @ApiAcceptedResponse({
    type: LoginResendResultDto,
    description: 'A new code or link was sent.',
  })
  @ApiErrorResponse(
    400,
    '`bad_request`: the body is invalid, or the attempt is unknown, ' +
      'already used or replaced.',
  )
  @ApiErrorResponse(
    401,
    '`invalid_credentials`: the user is no longer `active`.',
  )
  @ApiRateLimitResponse(
    'the last email was sent less than 60 seconds ago, or five wrong ' +
      'codes used up the attempt.',
  )
  @ApiLoginUnavailableResponse(
    'the database failed, or the email could not be sent (the new secret ' +
      'is saved; retry after 60 seconds).',
  )
  resendLogin(@Body() dto: ResendLoginDto): Promise<LoginResendResult> {
    return this.authService.resendLogin(dto);
  }

  /**
   * 204 with a new pair of cookies. The token is read only from the
   * `refresh_token` cookie: never from the body, the query or another header.
   *
   * 401 `invalid_session` for a missing or invalid token and for a missing or
   * non-active user, 503 (no cookies) if the database or signing fails.
   * 429 over 30 requests per IP per minute.
   */
  @Post('refresh')
  @Public()
  @LoginThrottle()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Get a new pair of auth cookies',
    description:
      'Reads the token only from the `refresh_token` cookie, which the ' +
      'browser sends to this path alone. No body.',
  })
  @ApiCookieAuth(REFRESH_TOKEN_COOKIE)
  @ApiAuthPost()
  @ApiAuthCookiesSet('A new pair.')
  @ApiErrorResponse(
    401,
    '`invalid_session`: the refresh token is missing, invalid or expired, ' +
      'or the user is missing or not `active`. Log in again.',
  )
  @ApiRateLimitResponse('over 30 requests per IP per minute.')
  @ApiLoginUnavailableResponse(
    'the database or token signing failed. The old refresh cookie still ' +
      'works for a retry.',
  )
  async refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const { accessToken, refreshToken } = await this.authService.refresh(
      request.cookies[REFRESH_TOKEN_COOKIE],
    );
    setAuthCookies(reply, accessToken, refreshToken, this.cookieSameSite);
  }

  /**
   * Always 204, no body. Needs no valid token: it only tells this browser to
   * delete both cookies (same `Path`, `Secure`, `SameSite`, no `Domain` as
   * when they were set). Nothing is stored or revoked on the server, so a
   * copied refresh token stays valid until its `exp` (stateless scheme).
   */
  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Log out',
    description:
      'Needs no valid token. Nothing is revoked on the server (the tokens ' +
      'are stateless): the browser only deletes its cookies.',
  })
  @ApiAuthPost()
  @ApiNoContentResponse({
    description:
      'Always. No body. Clears both cookies (`Max-Age=0`, same `Path` as ' +
      'when they were set).',
    headers: {
      'Set-Cookie': {
        description:
          'Two headers that clear `access_token` and `refresh_token`.',
        schema: { type: 'string' },
      },
    },
  })
  logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): void {
    // Only for the log: the cookies are cleared whatever the token is.
    this.authService.logout(request.cookies?.[ACCESS_TOKEN_COOKIE]);
    clearAuthCookies(reply, this.cookieSameSite);
  }
}
