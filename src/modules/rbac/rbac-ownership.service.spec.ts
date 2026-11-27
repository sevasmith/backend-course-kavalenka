import { ForbiddenException } from '@nestjs/common';

import { ErrorCode } from '@/core/http/api-error';
import { RbacAuthorizationService } from './rbac-authorization.service';
import { RbacOwnershipService } from './rbac-ownership.service';
import { RbacPolicyUnavailableError } from './rbac-policy-snapshot.service';

describe('RbacOwnershipService', () => {
  let authorize: jest.Mock;
  let service: RbacOwnershipService;

  const check = {
    actorUserId: 'alice',
    ownerId: 'bob',
    permission: 'users',
    anyAction: 'read_any',
  };

  beforeEach(() => {
    authorize = jest.fn();
    service = new RbacOwnershipService({
      authorize,
    } as unknown as RbacAuthorizationService);
  });

  it('allows the owner without asking RBAC', async () => {
    await expect(
      service.assertOwnerOrAny({ ...check, ownerId: 'alice' }),
    ).resolves.toBeUndefined();
    expect(authorize).not.toHaveBeenCalled();
  });

  it('allows someone else with the *_any action', async () => {
    authorize.mockResolvedValue(true);

    await expect(service.assertOwnerOrAny(check)).resolves.toBeUndefined();
    expect(authorize).toHaveBeenCalledWith('alice', 'users', 'read_any');
  });

  it('denies someone else without the *_any action with ownership_denied', async () => {
    authorize.mockResolvedValue(false);

    const error = await service
      .assertOwnerOrAny(check)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    const body = (error as ForbiddenException).getResponse();
    expect(body).toMatchObject({ code: ErrorCode.OWNERSHIP_DENIED });
    // The 403 must not reveal the owner or the missing action.
    expect(JSON.stringify(body)).not.toMatch(/bob|read_any/);
  });

  it('keeps an unavailable snapshot as 503, never a 403', async () => {
    authorize.mockRejectedValue(new RbacPolicyUnavailableError());

    await expect(service.assertOwnerOrAny(check)).rejects.toBeInstanceOf(
      RbacPolicyUnavailableError,
    );
  });
});
