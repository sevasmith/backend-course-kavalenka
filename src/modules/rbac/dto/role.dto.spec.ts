import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { RoleBodyDto } from './role.dto';

describe('RoleBodyDto', () => {
  const parse = async (body: object) => {
    const dto = plainToInstance(RoleBodyDto, body);
    return { dto, errors: await validate(dto) };
  };

  const expectInvalid = async (body: object) =>
    expect((await parse(body)).errors.length).toBeGreaterThan(0);

  it('trims and lowercases the name', async () => {
    const { dto, errors } = await parse({ name: '  Editor.Team_1-a ' });
    expect(errors).toHaveLength(0);
    expect(dto.name).toBe('editor.team_1-a');
  });

  it('accepts names of 1 and 64 characters', async () => {
    expect((await parse({ name: 'a' })).errors).toHaveLength(0);
    expect((await parse({ name: 'a'.repeat(64) })).errors).toHaveLength(0);
  });

  it.each([
    [''],
    ['   '],
    ['a'.repeat(65)],
    ['1admin'],
    ['_admin'],
    ['ad min'],
    ['admin!'],
    ['админ'],
    [123],
    [null],
  ])('rejects the name %p', async (name) => {
    await expectInvalid({ name });
  });

  it('rejects a missing name', async () => {
    await expectInvalid({});
  });

  it('trims the description', async () => {
    const { dto, errors } = await parse({
      name: 'editor',
      description: '  Edits things  ',
    });
    expect(errors).toHaveLength(0);
    expect(dto.description).toBe('Edits things');
  });

  it('turns an empty description into null', async () => {
    const { dto, errors } = await parse({ name: 'editor', description: '  ' });
    expect(errors).toHaveLength(0);
    expect(dto.description).toBeNull();
  });

  it('accepts a missing description', async () => {
    expect((await parse({ name: 'editor' })).errors).toHaveLength(0);
  });

  it('accepts a description of 500 characters after trimming', async () => {
    const description = ` ${'x'.repeat(500)} `;
    expect((await parse({ name: 'editor', description })).errors).toHaveLength(
      0,
    );
  });

  it('rejects a description longer than 500 characters', async () => {
    await expectInvalid({ name: 'editor', description: 'x'.repeat(501) });
  });

  it('rejects a description that is not a string', async () => {
    await expectInvalid({ name: 'editor', description: 42 });
  });
});
