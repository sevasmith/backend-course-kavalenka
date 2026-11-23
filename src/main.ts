import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import compression from '@fastify/compress';
import fastifyCookie from '@fastify/cookie';
import { ValidationPipe } from '@nestjs/common';
import {
  initializeTransactionalContext,
  StorageDriver,
} from 'typeorm-transactional';

import { AppModule } from './core/app/app.module';
import { ConfigService } from '@/core/config/config.service';
import { setupCors } from '@/core/http/cors';
import { setupOpenApi } from '@/core/http/openapi';

async function bootstrap() {
  initializeTransactionalContext({ storageDriver: StorageDriver.AUTO });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  await app.register(compression);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const configService = app.get(ConfigService);

  setupCors(app);

  await app.register(fastifyCookie, {
    secret: configService.get('COOKIE_SECRET'),
  });

  setupOpenApi(app);

  const port = configService.get('PORT');

  await app.listen(port);
}

bootstrap().catch((error) => {
  console.error('Failed to start the application', error);
  process.exit(1);
});
