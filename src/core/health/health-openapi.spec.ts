import { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { ConfigService } from '@/core/config/config.service';
import { buildOpenApiDocument } from '@/core/http/openapi';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('Health OpenAPI document', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => true } },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
    document = buildOpenApiDocument(app);
  });

  afterAll(() => app.close());

  it('documents GET /health as public, with 200, 429 and 503', () => {
    const operation = document.paths['/health']?.get;

    expect(operation?.tags).toEqual(['Health']);
    expect(operation?.security).toBeUndefined();
    expect(Object.keys(operation?.responses ?? {}).sort()).toEqual(
      ['200', '429', '503'].sort(),
    );
  });
});
