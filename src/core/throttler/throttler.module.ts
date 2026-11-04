import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerModule as NestThrottlerModule,
} from '@nestjs/throttler';

import { ConfigModule } from '@/core/config/config.module';
import { ConfigService } from '@/core/config/config.service';
import {
  isRegistrationThrottled,
  REGISTRATION_THROTTLER,
} from './throttler.decorators';

@Module({
  imports: [
    NestThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const ttl = Number(config.get('THROTTLE_GLOBAL_TTL'));
        const limit = Number(config.get('THROTTLE_GLOBAL_LIMIT'));

        return [
          {
            ttl,
            limit,
          },
          /**
           * Every named throttler applies to every route, so this one is
           * skipped unless the route has `@RegistrationThrottle()`.
           */
          {
            name: REGISTRATION_THROTTLER,
            ttl: Number(config.get('THROTTLE_REGISTRATION_TTL')),
            limit: Number(config.get('THROTTLE_REGISTRATION_LIMIT')),
            skipIf: (context) => !isRegistrationThrottled(context),
          },
        ];
      },
    }),
  ],
  providers: [
    /**
     * Without a guard the limits above are never checked. The guard counts
     * per IP and per route, in process memory.
     */
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
  exports: [NestThrottlerModule],
})
export class ThrottlerModule {}
