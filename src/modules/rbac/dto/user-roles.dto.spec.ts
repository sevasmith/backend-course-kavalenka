import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { toUserRolesResponse, UserRolesBodyDto } from './user-roles.dto';

const ROLE_A = '0b6f1c2a-3d4e-4f5a-8b6c-7d8e9f0a1b2c';
const ROLE_B = '3a7d1f0e-2b4c-4e6a-8d9f-1c2b3a4d5e6f';

describe('UserRolesBodyDto', () => {
  const parse = async (body: object) => {
    const dto = plainToInstance(UserRolesBodyDto, body);
    return { dto, errors: await validate(dto) };
  };

  const expectInvalid = async (body: object) =>
    expect((await parse(body)).errors.length).toBeGreaterThan(0);

  it('accepts an empty list (removes all roles)', async () => {
    expect((await parse({ roleIds: [] })).errors).toHaveLength(0);
  });

  it('accepts unique UUIDs and lowercases them', async () => {
    const { dto, errors } = await parse({
      roleIds: [ROLE_A.toUpperCase(), ROLE_B],
    });
    expect(errors).toHaveLength(0);
    expect(dto.roleIds).toEqual([ROLE_A, ROLE_B]);
  });

  it('rejects a repeated id, also one that differs only in case', async () => {
    await expectInvalid({ roleIds: [ROLE_A, ROLE_A] });
    await expectInvalid({ roleIds: [ROLE_A, ROLE_A.toUpperCase()] });
  });

  it.each([[undefined], [ROLE_A], [['admin']], [[42]]])(
    'rejects roleIds %p',
    async (roleIds) => {
      await expectInvalid({ roleIds });
    },
  );
});

describe('toUserRolesResponse', () => {
  it('returns only the ids, sorted', () => {
    expect(toUserRolesResponse('u1', [ROLE_B, ROLE_A])).toEqual({
      userId: 'u1',
      roleIds: [ROLE_A, ROLE_B],
    });
  });
});
