import { ExecutionContext, ForbiddenException } from '@nestjs/common';

import { ConfigService } from '@/core/config/config.service';
import { CsrfGuard } from './csrf.guard';

interface TestRequest {
  method: string;
  headers: Record<string, string | undefined>;
  id?: string;
}

function contextFor(request: TestRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('CsrfGuard', () => {
  const trusted = 'https://app.example.com';
  const apiHost = 'api.example.com';

  let guard: CsrfGuard;

  beforeEach(() => {
    guard = new CsrfGuard({
      get: () => [trusted],
    } as unknown as ConfigService);
  });

  const check = (method: string, headers: TestRequest['headers']) =>
    guard.canActivate(
      contextFor({ method, headers: { host: apiHost, ...headers } }),
    );

  const expectRejected = (method: string, headers: TestRequest['headers']) => {
    let error: unknown;
    try {
      check(method, headers);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      code: 'csrf_rejected',
    });
  };

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'lets a safe %s through from any origin',
    (method) => {
      expect(check(method, { origin: 'https://evil.example' })).toBe(true);
    },
  );

  it('lets a request without Origin through (not from a browser)', () => {
    expect(check('POST', {})).toBe(true);
  });

  it('lets a same-origin request through without the header', () => {
    expect(check('POST', { origin: `https://${apiHost}` })).toBe(true);
  });

  it('compares the host case-insensitively', () => {
    expect(
      check('POST', { origin: `https://${apiHost}`, host: 'API.example.com' }),
    ).toBe(true);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'lets a trusted origin with the header through: %s',
    (method) => {
      expect(check(method, { origin: trusted, 'x-csrf-protection': '1' })).toBe(
        true,
      );
    },
  );

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'rejects an untrusted origin even with the header: %s',
    (method) => {
      expectRejected(method, {
        origin: 'https://evil.example',
        'x-csrf-protection': '1',
      });
    },
  );

  it('rejects a trusted origin without the header', () => {
    expectRejected('POST', { origin: trusted });
  });

  it.each(['0', 'true', ' 1', ''])(
    'rejects a trusted origin with the header set to %p',
    (value) => {
      expectRejected('POST', { origin: trusted, 'x-csrf-protection': value });
    },
  );

  it('rejects a same-site neighbour that is not in the list', () => {
    expectRejected('POST', {
      origin: 'https://evil.example.com',
      'x-csrf-protection': '1',
    });
  });

  it('matches the origin exactly (scheme and port count)', () => {
    expectRejected('POST', {
      origin: 'http://app.example.com',
      'x-csrf-protection': '1',
    });
    expectRejected('POST', {
      origin: 'https://app.example.com:8443',
      'x-csrf-protection': '1',
    });
  });

  it('rejects Origin: null', () => {
    expectRejected('POST', { origin: 'null', 'x-csrf-protection': '1' });
  });

  it('rejects when Host is missing, so it cannot look same-origin', () => {
    expectRejected('POST', {
      origin: `https://${apiHost}`,
      host: undefined,
    });
  });
});
