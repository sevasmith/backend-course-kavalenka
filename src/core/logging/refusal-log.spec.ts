import { TokenFailure } from '@/modules/auth/token.types';
import {
  ForbiddenCategory,
  formatRefusal,
  UnauthorizedCategory,
  UnavailableCategory,
} from './refusal-log';
import * as requestContext from './request-context';

describe('refusal log', () => {
  afterEach(() => jest.restoreAllMocks());

  it('has exactly the categories of 1.3 §1.5', () => {
    expect(Object.values(UnauthorizedCategory)).toEqual([
      'missing',
      'malformed',
      'signature',
      'expired',
      'claims',
      'token_use',
      'user_inactive',
    ]);
    expect(Object.values(ForbiddenCategory)).toEqual([
      'permission_denied',
      'ownership_denied',
      'csrf_rejected',
    ]);
    expect(Object.values(UnavailableCategory)).toEqual([
      'users',
      'rbac_version',
      'rbac_snapshot',
      'route_configuration',
    ]);
  });

  it('covers every token failure with a 401 category', () => {
    const categories: string[] = Object.values(UnauthorizedCategory);
    for (const failure of Object.values(TokenFailure)) {
      expect(categories).toContain(failure);
    }
  });

  it('formats one line with the request id last, skipping undefined', () => {
    jest.spyOn(requestContext, 'currentRequestId').mockReturnValue('req-1');

    expect(
      formatRefusal(
        { status: 401, category: 'expired' },
        { userId: 'u1', detail: undefined },
      ),
    ).toBe(
      'access.refused status=401 category=expired userId=u1 requestId=req-1',
    );
  });

  it('leaves out the request id outside a request', () => {
    expect(formatRefusal({ status: 503, category: 'users' })).toBe(
      'access.refused status=503 category=users',
    );
  });
});
