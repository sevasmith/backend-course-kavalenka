import { Test, TestingModule } from '@nestjs/testing';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const password = 'secret12';

  let service: PasswordService;
  let hash: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PasswordService],
    }).compile();

    service = module.get<PasswordService>(PasswordService);
    hash = await service.hash(password);
  });

  it('produces an argon2id hash, not the password itself', () => {
    expect(hash).not.toBe(password);
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('uses a new salt for every hash', async () => {
    const again = await service.hash(password);

    expect(again).not.toBe(hash);
  });

  it('verifies the original password', async () => {
    await expect(service.verify(hash, password)).resolves.toBe(true);
  });

  it('rejects a different password', async () => {
    await expect(service.verify(hash, 'secret13')).resolves.toBe(false);
  });

  it('keeps leading and trailing whitespace significant', async () => {
    await expect(service.verify(hash, ` ${password} `)).resolves.toBe(false);
  });
});
