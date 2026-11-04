import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotImplementedException,
  Post,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { RegisterDto } from './dto/register.dto';
import { ConfirmRegistrationDto } from './dto/confirm-registration.dto';
import { AuthService } from './auth.service';
import { RegisterPendingResult, RegisterResult } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * 201 when the account is created active, 202 when it waits for email
   * confirmation. `passthrough` keeps Nest serializing the returned body.
   */
  @Post('register')
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

  @Post('register/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmRegistration(
    @Body() dto: ConfirmRegistrationDto,
  ): Promise<void> {
    await this.authService.confirmRegistration(dto);

    // TODO(step 8): return 200 with id, email and status: active.
    // Until then the found attempt is not returned: it holds the secret hash.
    throw new NotImplementedException(
      'Registration confirmation is not finished yet',
    );
  }
}
