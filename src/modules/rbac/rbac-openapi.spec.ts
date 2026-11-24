import { INestApplication } from '@nestjs/common';
import { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { buildOpenApiDocument } from '@/core/http/openapi';
import { RbacAdminAuditInterceptor } from './rbac-admin-audit.interceptor';
import { RbacAuditLogger } from './rbac-audit.logger';
import { RbacGrantsController } from './rbac-grants.controller';
import { RbacGrantsService } from './rbac-grants.service';
import { RbacPermissionsController } from './rbac-permissions.controller';
import { RbacPermissionsService } from './rbac-permissions.service';
import { RbacRolesController } from './rbac-roles.controller';
import { RbacRolesService } from './rbac-roles.service';
import { RbacUserRolesController } from './rbac-user-roles.controller';
import { RbacUserRolesService } from './rbac-user-roles.service';

/**
 * Builds the real OpenAPI document from the RBAC controllers (services
 * mocked, no DB) and checks the contract the docs promise.
 */
describe('RBAC OpenAPI document', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        RbacRolesController,
        RbacPermissionsController,
        RbacGrantsController,
        RbacUserRolesController,
      ],
      providers: [
        RbacAuditLogger,
        RbacAdminAuditInterceptor,
        { provide: RbacRolesService, useValue: {} },
        { provide: RbacPermissionsService, useValue: {} },
        { provide: RbacGrantsService, useValue: {} },
        { provide: RbacUserRolesService, useValue: {} },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
    document = buildOpenApiDocument(app);
  });

  afterAll(() => app.close());

  const operations = () =>
    Object.entries(document.paths).flatMap(([path, item]) =>
      (['get', 'post', 'put', 'delete'] as const)
        .filter((method) => item[method])
        .map((method) => ({ path, method, operation: item[method]! })),
    );

  it('documents every RBAC admin endpoint', () => {
    expect(
      operations()
        .map(({ method, path }) => `${method.toUpperCase()} ${path}`)
        .sort(),
    ).toEqual(
      [
        'GET /admin/rbac/roles',
        'POST /admin/rbac/roles',
        'PUT /admin/rbac/roles/{roleId}',
        'DELETE /admin/rbac/roles/{roleId}',
        'GET /admin/rbac/permissions',
        'POST /admin/rbac/permissions',
        'PUT /admin/rbac/permissions/{permissionId}',
        'DELETE /admin/rbac/permissions/{permissionId}',
        'GET /admin/rbac/grants',
        'POST /admin/rbac/grants',
        'PUT /admin/rbac/grants/{grantId}',
        'DELETE /admin/rbac/grants/{grantId}',
        'GET /admin/rbac/users/{userId}/roles',
        'PUT /admin/rbac/users/{userId}/roles',
      ].sort(),
    );
  });

  it('gives every write endpoint the CSRF header and both 403 codes', () => {
    for (const { method, operation } of operations()) {
      const hasHeader = (operation.parameters ?? []).some(
        (p) => 'name' in p && p.name === 'X-CSRF-Protection',
      );
      const forbidden = (operation.responses['403'] as { description: string })
        .description;

      expect(hasHeader).toBe(method !== 'get');
      expect(forbidden).toContain('permission_denied');
      if (method === 'get') {
        expect(forbidden).not.toContain('csrf_rejected');
      } else {
        expect(forbidden).toContain('csrf_rejected');
      }
    }
  });

  it('gives every endpoint cookie auth and the 401/403/429/503 errors', () => {
    // The scheme the routes reference must exist, or Swagger UI can't use it.
    expect(document.components?.securitySchemes?.access_token).toEqual({
      type: 'apiKey',
      in: 'cookie',
      name: 'access_token',
    });
    for (const { operation } of operations()) {
      expect(operation.security).toEqual([{ access_token: [] }]);
      for (const status of ['401', '403', '429', '503']) {
        expect(operation.responses[status]).toBeDefined();
      }
    }
  });

  it('documents the error body and the response schemas', () => {
    const schemas = document.components?.schemas ?? {};
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining([
        'ApiErrorResponseDto',
        'RoleBodyDto',
        'RoleResponse',
        'PermissionBodyDto',
        'PermissionResponse',
        'GrantBodyDto',
        'GrantResponse',
        'UserRolesBodyDto',
        'UserRolesResponse',
      ]),
    );
  });

  it('does not expose the actor id as a parameter', () => {
    for (const { operation } of operations()) {
      const names = (operation.parameters ?? []).map((p) =>
        'name' in p ? p.name : '',
      );
      expect(names).not.toContain('actorUserId');
    }
  });
});
