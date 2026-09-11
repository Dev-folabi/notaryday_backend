import * as nodemailer from 'nodemailer';
import {
  MailerProvider,
  MailerSendOptions,
  MailerSendResult,
} from './mailer-provider.interface';

export interface SmtpCredentials {
  user: string;
  password: string;
  host?: string;
  port?: number;
}

const DEFAULT_HOSTS: Record<string, { host: string; port: number }> = {
  zoho: { host: 'smtp.zoho.com', port: 587 },
  gmail: { host: 'smtp.gmail.com', port: 465 },
};

/** Generic SMTP adapter used for Zoho Mail and personal Gmail accounts. */
export class SmtpMailer implements MailerProvider {
  readonly type: string;
  private readonly transporter: nodemailer.Transporter;

  constructor(providerKind: 'zoho' | 'gmail', credentials: SmtpCredentials) {
    const defaults = DEFAULT_HOSTS[providerKind];
    const host = credentials.host?.trim() || defaults.host;
    const port = Number(credentials.port) || defaults.port;
    this.type = providerKind;
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user: credentials.user, pass: credentials.password },
      // cold outreach should not burn the pooled connection on one failure
      pool: true,
      maxConnections: 3,
    });
  }

  async send(options: MailerSendOptions): Promise<MailerSendResult> {
    const info = await this.transporter.sendMail({
      from: `${options.fromName} <${options.fromEmail}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo || undefined,
      headers: options.headers,
    });
    return {
      providerMessageId: info.messageId,
      raw: { accepted: info.accepted },
    };
  }
}
