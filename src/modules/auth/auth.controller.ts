import { Body, Controller, HttpStatus, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { RegisterDto } from './dto/register.dto';
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
}
