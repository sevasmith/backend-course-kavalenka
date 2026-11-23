import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailModule } from '@/core/mail/mail.module';
import { AuthController } from './auth.controller';
import { PasswordService } from './password.service';
import { AuthService } from './auth.service';
import { RegistrationChallenge } from './registration-challenge.entity';
import { RegistrationChallengeService } from './registration-challenge.service';
import { LoginChallenge } from './login-challenge.entity';
import { LoginChallengeService } from './login-challenge.service';
import { TokenService } from './token.service';
import { LoginAttemptLimiter } from './login-attempt-limiter';
import { AccessCheckGuard } from './access-check.guard';
import { UsersModule } from '../users/users.module';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports: [
    UsersModule,
    RbacModule,
    MailModule,
    TypeOrmModule.forFeature([RegistrationChallenge, LoginChallenge]),
  ],
  controllers: [AuthController],
  providers: [
    PasswordService,
    AuthService,
    RegistrationChallengeService,
    LoginChallengeService,
    TokenService,
    LoginAttemptLimiter,
    AccessCheckGuard,
  ],
  // Registered as a global guard in `AppModule`, before `RbacGuard`.
  exports: [AccessCheckGuard],
})
export class AuthModule {}
