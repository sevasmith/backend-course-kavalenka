import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { LoginDto } from './login.dto';

describe('LoginDto', () => {
  const toDto = (body: object) => plainToInstance(LoginDto, body);

  it('trims and lowercases the email, like registration', async () => {
    const dto = toDto({ email: '  User+Tag@Example.COM ', password: 'x' });

    expect(dto.email).toBe('user+tag@example.com');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('keeps the password exactly as sent', async () => {
    const dto = toDto({ email: 'user@example.com', password: ' Pass 1 ' });

    expect(dto.password).toBe(' Pass 1 ');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('does not apply the registration strength rules', async () => {
    const dto = toDto({ email: 'user@example.com', password: 'short' });

    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    [{}],
    [{ email: 'user@example.com' }],
    [{ password: 'secret12' }],
    [{ email: 'not-an-email', password: 'secret12' }],
    [{ email: 'user@example.com', password: '' }],
    [{ email: 'user@example.com', password: 123 }],
    [{ email: 'user@example.com', password: 'a'.repeat(129) }],
  ])('rejects %p', async (body) => {
    expect((await validate(toDto(body))).length).toBeGreaterThan(0);
  });
});
