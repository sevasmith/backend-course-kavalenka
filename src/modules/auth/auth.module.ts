import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { PasswordService } from './password.service';

@Module({
  controllers: [AuthController],
  providers: [PasswordService],
})
export class AuthModule {}
