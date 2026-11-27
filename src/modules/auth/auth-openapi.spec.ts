import { INestApplication } from '@nestjs/common';
import type {
  OpenAPIObject,
  OperationObject,
  ResponseObject,
  SchemaObject,
} from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { ConfigService } from '@/core/config/config.service';
import { buildOpenApiDocument } from '@/core/http/openapi';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * Builds the real OpenAPI document from `AuthController` (service mocked,
 * no DB) and checks the 1.2 contract: cookies, 204/202 and the error codes.
 */
describe('Auth OpenAPI document', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => 'strict' } },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
    document = buildOpenApiDocument(app);
  });

  afterAll(() => app.close());

  const post = (path: string): OperationObject => {
    const operation = document.paths[path]?.post;
    if (!operation) throw new Error(`POST ${path} is not documented`);
    return operation;
  };

  const response = (path: string, status: string) =>
    post(path).responses[status] as ResponseObject;

  const statuses = (path: string) => Object.keys(post(path).responses).sort();

  const schemaFields = (name: string) =>
    Object.keys(
      (document.components?.schemas?.[name] as SchemaObject).properties ?? {},
    ).sort();

  it('documents the status codes of each registration endpoint', () => {
    expect(statuses('/auth/register')).toEqual(
      ['201', '202', '400', '403', '409', '429', '503'].sort(),
    );
    expect(statuses('/auth/register/confirm')).toEqual(
      ['200', '400', '403', '429'].sort(),
    );
    expect(statuses('/auth/register/resend')).toEqual(
      ['202', '400', '403', '429', '503'].sort(),
    );
  });

  it('describes the registration bodies, never with a secret', () => {
    expect(schemaFields('RegisterDto')).toEqual(['email', 'password']);
    expect(schemaFields('ConfirmRegistrationDto')).toEqual(
      ['attemptId', 'code', 'token'].sort(),
    );
    expect(schemaFields('ResendRegistrationDto')).toEqual(['email']);
    expect(schemaFields('RegisterResultDto')).toEqual(
      ['email', 'id', 'status'].sort(),
    );
    expect(schemaFields('RegisterPendingResultDto')).toEqual(
      schemaFields('LoginConfirmationRequiredDto'),
    );
  });

  it('documents the status codes of each 1.2 endpoint', () => {
    expect(statuses('/auth/login')).toEqual(
      ['202', '204', '400', '401', '403', '429', '503'].sort(),
    );
    expect(statuses('/auth/login/confirm')).toEqual(
      ['204', '400', '401', '403', '429', '503'].sort(),
    );
    expect(statuses('/auth/login/resend')).toEqual(
      ['202', '400', '401', '403', '429', '503'].sort(),
    );
    expect(statuses('/auth/refresh')).toEqual(
      ['204', '401', '403', '429', '503'].sort(),
    );
    // 429: the global per-IP limit applies even to logout.
    expect(statuses('/auth/logout')).toEqual(['204', '403', '429'].sort());
  });

  it('documents Set-Cookie on every 204', () => {
    for (const path of [
      '/auth/login',
      '/auth/login/confirm',
      '/auth/refresh',
      '/auth/logout',
    ]) {
      expect(response(path, '204').headers?.['Set-Cookie']).toBeDefined();
    }
  });

  it('describes the 202 bodies, never with a secret', () => {
    expect(schemaFields('LoginConfirmationRequiredDto')).toEqual(
      [
        'confirmationRequired',
        'method',
        'attemptId',
        'expiresInSeconds',
        'resendAfterSeconds',
      ].sort(),
    );
    expect(schemaFields('LoginResendResultDto')).toEqual(
      ['method', 'attemptId', 'expiresInSeconds', 'resendAfterSeconds'].sort(),
    );
  });

  it('documents the request bodies', () => {
    expect(schemaFields('LoginDto')).toEqual(['email', 'password']);
    expect(schemaFields('ConfirmLoginDto')).toEqual(
      ['attemptId', 'code', 'token'].sort(),
    );
    expect(schemaFields('ResendLoginDto')).toEqual(['attemptId']);
  });

  it('documents retryAfterSeconds on the 429', () => {
    expect(schemaFields('RateLimitErrorDto')).toContain('retryAfterSeconds');
  });

  it('names the error code in every error description', () => {
    const codes = [
      'bad_request',
      'invalid_credentials',
      'invalid_session',
      'csrf_rejected',
      'conflict',
      'rate_limit_exceeded',
      'service_unavailable',
    ];
    for (const path of Object.keys(document.paths)) {
      for (const [status, value] of Object.entries(post(path).responses)) {
        if (Number(status) < 400) continue;
        const { description } = value as ResponseObject;
        expect(codes.some((code) => description.includes(code))).toBe(true);
      }
    }
  });

  it('marks only refresh as needing a cookie; login routes are public', () => {
    expect(document.components?.securitySchemes?.refresh_token).toEqual({
      type: 'apiKey',
      in: 'cookie',
      name: 'refresh_token',
    });
    expect(post('/auth/refresh').security).toEqual([{ refresh_token: [] }]);
    for (const path of [
      '/auth/login',
      '/auth/login/confirm',
      '/auth/login/resend',
      '/auth/logout',
    ]) {
      expect(post(path).security).toBeUndefined();
    }
  });

  it('gives no auth route the access cookie or the authorization errors', () => {
    // These routes are @Public(): the access check and RBAC never run.
    const chainOnly = [
      'permission_denied',
      'ownership_denied',
      'authorization_unavailable',
    ];
    for (const path of Object.keys(document.paths)) {
      const operation = post(path);
      expect(operation.security ?? []).not.toContainEqual({
        access_token: [],
      });
      for (const value of Object.values(operation.responses)) {
        const { description } = value as ResponseObject;
        for (const code of chainOnly) {
          expect(description).not.toContain(code);
        }
      }
    }
  });

  it('documents the CSRF header as optional on every auth route', () => {
    for (const path of Object.keys(document.paths)) {
      const header = (post(path).parameters ?? []).find(
        (parameter) =>
          'name' in parameter && parameter.name === 'X-CSRF-Protection',
      );
      expect(header).toMatchObject({ in: 'header', required: false });
    }
  });
});
