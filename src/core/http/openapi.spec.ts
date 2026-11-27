import { Controller, Delete, Get, INestApplication } from '@nestjs/common';
import type {
  OpenAPIObject,
  OperationObject,
  ResponseObject,
} from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import {
  ApiProtected,
  ApiProtectedWrite,
  buildOpenApiDocument,
} from './openapi';

/** Test-only routes: one of each kind the shared decorators describe. */
@Controller('docs-test')
class DocsTestController {
  @Get('public')
  publicRoute() {}

  @Get('read')
  @ApiProtected()
  read() {}

  @Delete('own/:id')
  @ApiProtected({ ownership: true })
  @ApiProtectedWrite({ ownership: true })
  removeOwn() {}
}

describe('Protected route OpenAPI decorators', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DocsTestController],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    document = buildOpenApiDocument(app);
  });

  afterAll(() => app.close());

  const operation = (path: string, method: 'get' | 'delete') => {
    const found = document.paths[path]?.[method];
    if (!found) throw new Error(`${method} ${path} is not documented`);
    return found;
  };

  const description = (op: OperationObject, status: string) =>
    (op.responses[status] as ResponseObject).description;

  it('gives a public route no cookie auth and no chain errors', () => {
    const op = operation('/docs-test/public', 'get');

    expect(op.security).toBeUndefined();
    for (const status of ['401', '403', '503']) {
      expect(op.responses[status]).toBeUndefined();
    }
  });

  it('gives a protected read cookie auth and the chain errors', () => {
    const op = operation('/docs-test/read', 'get');

    expect(op.security).toEqual([{ access_token: [] }]);
    expect(description(op, '401')).toContain('invalid_session');
    expect(description(op, '403')).toContain('permission_denied');
    expect(description(op, '403')).not.toContain('ownership_denied');
    expect(description(op, '403')).not.toContain('csrf_rejected');
    expect(op.responses['429']).toBeDefined();
    expect(description(op, '503')).toContain('authorization_unavailable');
  });

  it('names every 403 code and the CSRF header on an owned write', () => {
    const op = operation('/docs-test/own/{id}', 'delete');
    const forbidden = description(op, '403');

    expect(forbidden).toContain('permission_denied');
    expect(forbidden).toContain('ownership_denied');
    expect(forbidden).toContain('csrf_rejected');
    expect(
      (op.parameters ?? []).some(
        (p) => 'name' in p && p.name === 'X-CSRF-Protection',
      ),
    ).toBe(true);
  });
});
