import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { PermissionBodyDto } from './permission.dto';

describe('PermissionBodyDto', () => {
  const parse = async (body: object) => {
    const dto = plainToInstance(PermissionBodyDto, body);
    return { dto, errors: await validate(dto) };
  };

  const expectInvalid = async (body: object) =>
    expect((await parse(body)).errors.length).toBeGreaterThan(0);

  it('normalizes the name and every action', async () => {
    const { dto, errors } = await parse({
      name: ' Reports ',
      actions: [' Read', 'EXPORT '],
    });
    expect(errors).toHaveLength(0);
    expect(dto.name).toBe('reports');
    expect(dto.actions).toEqual(['read', 'export']);
  });

  it('accepts 64 actions', async () => {
    const actions = Array.from({ length: 64 }, (_, i) => `a${i}`);
    expect((await parse({ name: 'reports', actions })).errors).toHaveLength(0);
  });

  it('rejects missing or empty actions', async () => {
    await expectInvalid({ name: 'reports' });
    await expectInvalid({ name: 'reports', actions: [] });
  });

  it('rejects more than 64 actions', async () => {
    const actions = Array.from({ length: 65 }, (_, i) => `a${i}`);
    await expectInvalid({ name: 'reports', actions });
  });

  it('rejects a repeated action, also one that repeats after normalization', async () => {
    await expectInvalid({ name: 'reports', actions: ['read', 'read'] });
    await expectInvalid({ name: 'reports', actions: ['read', ' READ '] });
  });

  it.each([[['']], [['1read']], [['re ad']], [[42]], [[null]], ['read']])(
    'rejects the actions %p',
    async (actions) => {
      await expectInvalid({ name: 'reports', actions });
    },
  );

  it('rejects an invalid name', async () => {
    await expectInvalid({ name: 'bad name', actions: ['read'] });
  });

  it('turns an empty description into null', async () => {
    const { dto, errors } = await parse({
      name: 'reports',
      description: ' ',
      actions: ['read'],
    });
    expect(errors).toHaveLength(0);
    expect(dto.description).toBeNull();
  });
});
