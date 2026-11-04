import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ConfirmRegistrationDto } from './confirm-registration.dto';

describe('ConfirmRegistrationDto', () => {
  const attemptId = '0b8e5a52-3c0f-4c1e-9c1a-2f1b6f9d4e7a';
  const token = 'q1w2e3r4t5y6u7i8o9p0-_ASDFGHJKLzxcvbnm12345';

  const errorsFor = async (body: object) =>
    validate(plainToInstance(ConfirmRegistrationDto, body));

  const expectValid = async (body: object) =>
    expect(await errorsFor(body)).toHaveLength(0);

  const expectInvalid = async (body: object) =>
    expect((await errorsFor(body)).length).toBeGreaterThan(0);

  it('accepts the OTP form', async () => {
    await expectValid({ attemptId, code: '012345' });
  });

  it('accepts the magic link form', async () => {
    await expectValid({ token });
  });

  it('rejects an empty body', async () => {
    await expectInvalid({});
  });

  it('rejects a mix of both forms', async () => {
    await expectInvalid({ attemptId, code: '123456', token });
    await expectInvalid({ attemptId, token });
    await expectInvalid({ code: '123456', token });
  });

  it('rejects an incomplete OTP form', async () => {
    await expectInvalid({ attemptId });
    await expectInvalid({ code: '123456' });
  });

  it('rejects an attemptId that is not a UUID', async () => {
    await expectInvalid({ attemptId: 'not-a-uuid', code: '123456' });
  });

  it.each([['12345'], ['1234567'], ['12345a'], [' 123456'], [123456]])(
    'rejects the code %p',
    async (code) => {
      await expectInvalid({ attemptId, code });
    },
  );

  it.each([[''], ['abc+def'], ['abc/def'], ['abc='], [123], [null]])(
    'rejects the token %p',
    async (badToken) => {
      await expectInvalid({ token: badToken });
    },
  );

  it('rejects a token longer than 128 characters', async () => {
    await expectInvalid({ token: 'a'.repeat(129) });
  });
});
