import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { PasswordService } from './password.service';
import { AuthService } from './auth.service';
import { RegistrationChallenge } from './registration-challenge.entity';
import { RegistrationChallengeService } from './registration-challenge.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule, TypeOrmModule.forFeature([RegistrationChallenge])],
  controllers: [AuthController],
  providers: [PasswordService, AuthService, RegistrationChallengeService],
})
export class AuthModule {}
