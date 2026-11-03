import { Module } from '@nestjs/common';
import { createTransport } from 'nodemailer';

import { ConfigService } from '@/core/config/config.service';
import { MailService } from './mail.service';
import {
  MAIL_TRANSPORTER,
  MailTransporter,
  SMTP_TIMEOUT_MS,
} from './mail.types';

@Module({
  providers: [
    {
      provide: MAIL_TRANSPORTER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): MailTransporter => {
        const user = config.get('SMTP_USER');

        // No `logger` or `debug` options: they would log the message body
        // together with the confirmation code or link.
        return createTransport({
          host: config.get('SMTP_HOST'),
          port: config.get('SMTP_PORT'),
          secure: config.get('SMTP_SECURE'),
          auth: user ? { user, pass: config.get('SMTP_PASSWORD') } : undefined,
          connectionTimeout: SMTP_TIMEOUT_MS,
          greetingTimeout: SMTP_TIMEOUT_MS,
          socketTimeout: SMTP_TIMEOUT_MS,
        });
      },
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
