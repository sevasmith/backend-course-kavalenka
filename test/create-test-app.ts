import { ValidationPipe } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  initializeTransactionalContext,
  StorageDriver,
} from 'typeorm-transactional';

import { MailService } from '../src/core/mail/mail.service';
import type { AuthenticatedRequest } from '../src/modules/rbac/rbac.guard';

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
 * The header a test sends to act as a user, e.g. `x-test-user-id: <uuid>`.
 * Stub until 1.2 Authentication: there is no session yet, so this is the only
 * way to put a user into the auth context the RBAC guard reads.
 */
export const TEST_USER_HEADER = 'x-test-user-id';

export interface TestAppOptions {
  /** Read the acting user from `TEST_USER_HEADER`. Only for tests. */
  authenticateFromHeader?: boolean;
}

/**
 * Sets `request.user` from `TEST_USER_HEADER` before the guards run, the way
 * the real auth layer will set it from the session cookie in 1.2. Without
 * the header the request stays anonymous.
 */
function authenticateFromTestHeader(app: NestFastifyApplication): void {
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request, _reply, done) => {
      const userId = request.headers[TEST_USER_HEADER];
      if (typeof userId === 'string') {
        (request as AuthenticatedRequest).user = { id: userId };
      }
      done();
    });
}

/**
 * The real application (database, guards, validation) with the fake mailer.
 * Config comes from `.env`; `env` overrides single values.
 *
 * `ConfigModule.forRoot()` reads the config when its file is imported, so
 * `AppModule` is imported only after `process.env` is set. Jest gives every
 * test file its own module registry, so each file gets its own config.
 */
export async function createTestApp(
  env: Record<string, string> = {},
  options: TestAppOptions = {},
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
    imports: [AppModule],
  })
    .overrideProvider(MailService)
    .useValue(mail)
    .compile();

  const app = moduleFixture.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { logger: false },
  );
  // The same pipe as in main.ts.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  if (options.authenticateFromHeader) {
    authenticateFromTestHeader(app);
  }
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return { app, mail };
}
