import { ForbiddenException } from '@nestjs/common';

import { ErrorCode } from '@/core/http/api-error';
import { RbacAuditLogger } from './rbac-audit.logger';
import { RbacAuthorizationService } from './rbac-authorization.service';
import { RbacOwnershipService } from './rbac-ownership.service';
import { RbacPolicyUnavailableError } from './rbac-policy-snapshot.service';

describe('RbacOwnershipService', () => {
  let authorize: jest.Mock;
  let accessDenied: jest.Mock;
  let accessGranted: jest.Mock;
  let service: RbacOwnershipService;

  const check = {
    actorUserId: 'alice',
    ownerId: 'bob',
    permission: 'users',
    anyAction: 'read_any',
    operation: 'UsersController.findOne',
  };

  /** The audit fields both outcomes share (no request context in a unit test). */
  const event = {
    actorUserId: 'alice',
    permission: 'users',
    action: 'read_any',
    operation: 'UsersController.findOne',
    requestId: undefined,
    policyVersion: 5,
  };

  beforeEach(() => {
    authorize = jest.fn();
    accessDenied = jest.fn();
    accessGranted = jest.fn();
    service = new RbacOwnershipService(
      { authorize } as unknown as RbacAuthorizationService,
      { accessDenied, accessGranted } as unknown as RbacAuditLogger,
    );
  });

  it('allows the owner without asking RBAC or logging', async () => {
    await expect(
      service.assertOwnerOrAny({ ...check, ownerId: 'alice' }),
    ).resolves.toBeUndefined();
    expect(authorize).not.toHaveBeenCalled();
    expect(accessGranted).not.toHaveBeenCalled();
  });

  it('allows someone else with the *_any action and logs it with the target', async () => {
    authorize.mockResolvedValue({ allowed: true, policyVersion: 5 });

    await expect(service.assertOwnerOrAny(check)).resolves.toBeUndefined();
    expect(authorize).toHaveBeenCalledWith('alice', 'users', 'read_any');
    expect(accessGranted).toHaveBeenCalledWith({ ...event, targetId: 'bob' });
  });

  it('denies someone else without the *_any action with ownership_denied', async () => {
    authorize.mockResolvedValue({ allowed: false, policyVersion: 5 });

    const error = await service
      .assertOwnerOrAny(check)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    const body = (error as ForbiddenException).getResponse();
    expect(body).toMatchObject({ code: ErrorCode.OWNERSHIP_DENIED });
    // The 403 must not reveal the owner or the missing action.
    expect(JSON.stringify(body)).not.toMatch(/bob|read_any/);
    // The log has the actor and the action, but not the owner id.
    expect(accessDenied).toHaveBeenCalledWith(event, 'ownership_denied');
  });

  it('compares ids exactly, so a near match still needs *_any (fails closed)', async () => {
    authorize.mockResolvedValue({ allowed: false, policyVersion: 5 });

    await expect(
      service.assertOwnerOrAny({ ...check, ownerId: 'ALICE' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(authorize).toHaveBeenCalledWith('alice', 'users', 'read_any');
  });

  it('keeps an unavailable snapshot as 503, never a 403', async () => {
    authorize.mockRejectedValue(
      new RbacPolicyUnavailableError('rbac_snapshot'),
    );

    await expect(service.assertOwnerOrAny(check)).rejects.toBeInstanceOf(
      RbacPolicyUnavailableError,
    );
    expect(accessDenied).not.toHaveBeenCalled();
  });
});
