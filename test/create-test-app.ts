import fastifyCookie from '@fastify/cookie';
import { Type, ValidationPipe } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  initializeTransactionalContext,
  StorageDriver,
} from 'typeorm-transactional';

import { setupCors } from '../src/core/http/cors';
import { MailService } from '../src/core/mail/mail.service';
import { generateRequestId } from '../src/core/logging/request-context';

/**
 * Stands in for the SMTP mailer: keeps the last secret sent to each address,
 * so a test can confirm with it. `fail()` makes the next send throw.
 */
export class FakeMailService {
  private readonly secrets = new Map<string, string>();
  private failNext = false;

  sendRegistrationOtp(to: string, code: string): Promise<void> {
    return this.deliver(to, code);
  }

  sendRegistrationMagicLink(to: string, url: string): Promise<void> {
    return this.deliver(to, new URL(url).hash.slice(1));
  }

  sendLoginOtp(to: string, code: string): Promise<void> {
    return this.deliver(to, code);
  }

  /** Keeps the whole `attemptId.secret` token from the fragment. */
  sendLoginMagicLink(to: string, url: string): Promise<void> {
    return this.deliver(to, new URL(url).hash.slice(1));
  }

  lastSecret(to: string): string {
    const secret = this.secrets.get(to);
    if (secret === undefined) {
      throw new Error(`No email was sent to ${to}`);
    }
    return secret;
  }

  fail(): void {
    this.failNext = true;
  }

  private deliver(to: string, secret: string): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('ECONNREFUSED'));
    }
    this.secrets.set(to, secret);
    return Promise.resolve();
  }
}

/**
 * The real application (database, guards, validation) with the fake mailer.
 * Config comes from `.env`; `env` overrides single values.
 *
 * `ConfigModule.forRoot()` reads the config when its file is imported, so
 * `AppModule` is imported only after `process.env` is set. Jest gives every
 * test file its own module registry, so each file gets its own config.
 *
 * `extraImports` adds test-only modules (e.g. routes no real endpoint has
 * yet). They go through the same guards and startup route scan.
 */
export async function createTestApp(
  env: Record<string, string> = {},
  extraImports: Type[] = [],
): Promise<{
  app: NestFastifyApplication;
  mail: FakeMailService;
}> {
  Object.assign(process.env, env);
  // A synchronous require: Jest does not support `import()` without flags.
  const { AppModule } = jest.requireActual<
    typeof import('../src/core/app/app.module')
  >('../src/core/app/app.module');

  initializeTransactionalContext({ storageDriver: StorageDriver.AUTO });

  const mail = new FakeMailService();
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule, ...extraImports],
  })
    .overrideProvider(MailService)
    .useValue(mail)
    .compile();

  const app = moduleFixture.createNestApplication<NestFastifyApplication>(
    // The same request ids as in main.ts.
    new FastifyAdapter({ genReqId: generateRequestId }),
    { logger: false },
  );
  // The same pipe as in main.ts.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // The same cookie plugin and CORS as in main.ts.
  await app.register(fastifyCookie);
  setupCors(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return { app, mail };
}
