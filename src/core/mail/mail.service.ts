import { Inject, Injectable } from '@nestjs/common';

import { ConfigService } from '@/core/config/config.service';
import { MAIL_TRANSPORTER } from './mail.types';
import type { MailTransporter } from './mail.types';

/**
 * Sends emails over SMTP. Errors are not caught here: the caller decides what
 * a failed send means (for registration, a 503).
 */
@Injectable()
export class MailService {
  constructor(
    @Inject(MAIL_TRANSPORTER) private readonly transporter: MailTransporter,
    private readonly configService: ConfigService,
  ) {}

  async sendRegistrationOtp(to: string, code: string): Promise<void> {
    await this.send(
      to,
      'Confirm your registration',
      `Your confirmation code: ${code}\n\nIt expires in 10 minutes.`,
    );
  }

  async sendRegistrationMagicLink(to: string, url: string): Promise<void> {
    await this.send(
      to,
      'Confirm your registration',
      `Open this link to confirm your registration:\n${url}\n\nIt expires in 10 minutes.`,
    );
  }

  async sendLoginOtp(to: string, code: string): Promise<void> {
    await this.send(
      to,
      'Confirm your login',
      `Your login code: ${code}\n\nIt expires in 10 minutes. If you did not try to log in, change your password.`,
    );
  }

  async sendLoginMagicLink(to: string, url: string): Promise<void> {
    await this.send(
      to,
      'Confirm your login',
      `Open this link to confirm your login:\n${url}\n\nIt expires in 10 minutes. If you did not try to log in, change your password.`,
    );
  }

  private async send(to: string, subject: string, text: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.configService.get('SMTP_FROM'),
      to,
      subject,
      text,
    });
  }
}
