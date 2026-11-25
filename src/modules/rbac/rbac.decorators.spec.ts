import { Reflector } from '@nestjs/core';

import {
  getRouteAccess,
  Public,
  ReceiptHeader,
  RequirePermission,
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
