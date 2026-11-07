import { Test, TestingModule } from '@nestjs/testing';

import { ConfigService } from '@/core/config/config.service';
import { MailService } from './mail.service';
import { MAIL_TRANSPORTER } from './mail.types';

describe('MailService', () => {
  const from = 'no-reply@example.com';

  let service: MailService;
  let transporter: { sendMail: jest.Mock };

  beforeEach(async () => {
    transporter = { sendMail: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: MAIL_TRANSPORTER, useValue: transporter },
        { provide: ConfigService, useValue: { get: () => from } },
      ],
    }).compile();

    service = module.get(MailService);
  });

  it('sends the OTP code to the user', async () => {
    await service.sendRegistrationOtp('user@example.com', '042317');

    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from,
        to: 'user@example.com',
        text: expect.stringContaining('042317') as string,
      }),
    );
  });

  it('sends the magic link to the user', async () => {
    const url = 'http://localhost:3000/register/confirm#attempt-id.token';

    await service.sendRegistrationMagicLink('user@example.com', url);

    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        text: expect.stringContaining(url) as string,
      }),
    );
  });

  it('passes SMTP errors to the caller', async () => {
    transporter.sendMail.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      service.sendRegistrationOtp('user@example.com', '042317'),
    ).rejects.toThrow('ECONNREFUSED');
  });
});
