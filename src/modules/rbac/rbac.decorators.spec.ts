import { Reflector } from '@nestjs/core';

import {
  getRouteAccess,
  Public,
  ReceiptHeader,
  RequirePermission,
  resolveRequestAccess,
} from './rbac.decorators';

class Routes {
  @ReceiptHeader('Deletion-Receipt')
  receiptOnly() {}

  @ReceiptHeader('Deletion-Receipt')
  @RequirePermission('users', 'delete')
  receiptOrPair() {}

  @Public()
  @ReceiptHeader('Deletion-Receipt')
  publicAndReceipt() {}
}

const accessOf = (method: keyof Routes) =>
  getRouteAccess(new Reflector(), Routes.prototype[method], Routes);

describe('getRouteAccess', () => {
  it('reads a receipt alone', () => {
    expect(accessOf('receiptOnly')).toEqual({
      kind: 'receipt',
      header: 'Deletion-Receipt',
    });
  });

  it('reads a receipt together with one pair', () => {
    expect(accessOf('receiptOrPair')).toEqual({
      kind: 'receiptOrPermission',
      header: 'Deletion-Receipt',
      permission: 'users',
      action: 'delete',
    });
  });

  it('treats @Public() with a receipt as ambiguous', () => {
    expect(accessOf('publicAndReceipt')).toEqual({ kind: 'ambiguous' });
  });
});

describe('resolveRequestAccess', () => {
  const receipt = { kind: 'receipt', header: 'Deletion-Receipt' } as const;
  const receiptOrPair = {
    kind: 'receiptOrPermission',
    header: 'Deletion-Receipt',
    permission: 'users',
    action: 'delete',
  } as const;
  // Fastify lowercases header names.
  const withHeader = { 'deletion-receipt': 'r-123' };

  it('skips the chain when the receipt header is present', () => {
    const presented = { kind: 'receiptPresented', header: 'Deletion-Receipt' };

    expect(resolveRequestAccess(receipt, withHeader)).toEqual(presented);
    expect(resolveRequestAccess(receiptOrPair, withHeader)).toEqual(presented);
  });

  it('counts an empty header as present: the handler rejects it', () => {
    expect(resolveRequestAccess(receipt, { 'deletion-receipt': '' }).kind).toBe(
      'receiptPresented',
    );
  });

  it('falls back to the pair when the header is absent', () => {
    expect(resolveRequestAccess(receiptOrPair, {})).toEqual({
      kind: 'permission',
      permission: 'users',
      action: 'delete',
    });
  });

  it('marks a receipt-only route without the header as missing', () => {
    expect(resolveRequestAccess(receipt, undefined)).toEqual({
      kind: 'receiptMissing',
      header: 'Deletion-Receipt',
    });
  });

  it('leaves other routes unchanged', () => {
    const permission = {
      kind: 'permission',
      permission: 'users',
      action: 'read',
    } as const;

    expect(resolveRequestAccess(permission, withHeader)).toBe(permission);
    expect(resolveRequestAccess({ kind: 'public' }, {})).toEqual({
      kind: 'public',
    });
  });
});
