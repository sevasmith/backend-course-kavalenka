import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ResendRegistrationDto } from './resend-registration.dto';

describe('ResendRegistrationDto', () => {
  const toDto = (body: object) => plainToInstance(ResendRegistrationDto, body);

  it('trims and lowercases the email, like registration', async () => {
    const dto = toDto({ email: '  User+Tag@Example.COM ' });

    expect(dto.email).toBe('user+tag@example.com');
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([[{}], [{ email: 'not-an-email' }], [{ email: 123 }]])(
    'rejects %p',
    async (body) => {
      expect((await validate(toDto(body))).length).toBeGreaterThan(0);
    },
  );
});
