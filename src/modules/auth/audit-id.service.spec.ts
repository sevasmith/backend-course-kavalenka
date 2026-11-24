import { ConfigService } from '@/core/config/config.service';

import { AuditIdService } from './audit-id.service';

describe('AuditIdService', () => {
  const serviceWithKey = (key: string) =>
    new AuditIdService({
      get: () => key,
    } as unknown as ConfigService);

  const service = serviceWithKey('k'.repeat(32));
  const email = 'user@example.com';

  it('gives the same email the same id, so attempts can be grouped', () => {
    expect(service.forEmail(email)).toBe(service.forEmail(email));
  });

  it('gives different emails different ids', () => {
    expect(service.forEmail(email)).not.toBe(
      service.forEmail('other@example.com'),
    );
  });

  it('is 16 hex characters and contains nothing of the address', () => {
    const id = service.forEmail(email);

    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(id).not.toContain('user');
  });

  it('depends on the key: without it, a guessed email cannot be checked', () => {
    expect(serviceWithKey('z'.repeat(32)).forEmail(email)).not.toBe(
      service.forEmail(email),
    );
  });
});
