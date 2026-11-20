import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { Grant } from '../grant.entity';
import { GrantBodyDto, toGrantResponse } from './grant.dto';

const ROLE_ID = '0b6f1c2a-3d4e-4f5a-8b6c-7d8e9f0a1b2c';
const PERMISSION_ID = '3a7d1f0e-2b4c-4e6a-8d9f-1c2b3a4d5e6f';

describe('GrantBodyDto', () => {
  const parse = async (body: object) => {
    const dto = plainToInstance(GrantBodyDto, body);
    return { dto, errors: await validate(dto) };
  };

  const expectInvalid = async (body: object) =>
    expect((await parse(body)).errors.length).toBeGreaterThan(0);

  const ids = { roleId: ROLE_ID, permissionId: PERMISSION_ID };

  it('accepts missing or empty actions (all actions)', async () => {
    expect((await parse(ids)).errors).toHaveLength(0);
    expect((await parse({ ...ids, actions: [] })).errors).toHaveLength(0);
  });

  it('normalizes every action', async () => {
    const { dto, errors } = await parse({ ...ids, actions: [' Read', 'LIST'] });
    expect(errors).toHaveLength(0);
    expect(dto.actions).toEqual(['read', 'list']);
  });

  it('rejects a repeated action, also after normalization', async () => {
    await expectInvalid({ ...ids, actions: ['read', ' READ '] });
  });

  it('rejects more than 64 actions', async () => {
    const actions = Array.from({ length: 65 }, (_, i) => `a${i}`);
    await expectInvalid({ ...ids, actions });
  });

  it.each([[['1read']], [[42]], ['read']])(
    'rejects the actions %p',
    async (actions) => {
      await expectInvalid({ ...ids, actions });
    },
  );

  it('rejects ids that are missing or not UUIDs', async () => {
    await expectInvalid({ permissionId: PERMISSION_ID });
    await expectInvalid({ roleId: ROLE_ID });
    await expectInvalid({ roleId: 'admin', permissionId: PERMISSION_ID });
  });
});

describe('toGrantResponse', () => {
  const grant = (allActions: boolean): Grant =>
    Object.assign(new Grant(), {
      id: 'grant-1',
      roleId: ROLE_ID,
      permissionId: PERMISSION_ID,
      allActions,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

  it('returns sorted actions for an explicit grant', () => {
    expect(toGrantResponse(grant(false), ['read', 'list'])).toMatchObject({
      allActions: false,
      actions: ['list', 'read'],
    });
  });

  it('always returns [] for an all-actions grant', () => {
    expect(toGrantResponse(grant(true), ['read'])).toMatchObject({
      allActions: true,
      actions: [],
    });
  });
});
