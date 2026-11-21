import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ResendLoginDto } from './resend-login.dto';

describe('ResendLoginDto', () => {
  const errorsFor = (body: object) =>
    validate(plainToInstance(ResendLoginDto, body));

  it('accepts an attemptId', async () => {
    expect(
      await errorsFor({ attemptId: '0b8e5a52-3c0f-4c1e-9c1a-2f1b6f9d4e7a' }),
    ).toHaveLength(0);
  });

  it.each([[{}], [{ attemptId: 'not-a-uuid' }], [{ attemptId: 123 }]])(
    'rejects %p',
    async (body) => {
      expect((await errorsFor(body)).length).toBeGreaterThan(0);
    },
  );
});
