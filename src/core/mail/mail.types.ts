import type { Transporter } from 'nodemailer';

/**
 * DI token of the nodemailer transporter, so tests can replace it with a mock.
 */
export const MAIL_TRANSPORTER = Symbol('MAIL_TRANSPORTER');

export type MailTransporter = Pick<Transporter, 'sendMail'>;

/**
 * Nodemailer waits up to 2 minutes by default. Fail fast instead, so the API
 * can answer 503 while the client is still waiting.
 */
export const SMTP_TIMEOUT_MS = 5000;
