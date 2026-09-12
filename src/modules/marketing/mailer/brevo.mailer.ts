import axios from 'axios';
import {
  MailerProvider,
  MailerSendOptions,
  MailerSendResult,
} from './mailer-provider.interface';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

/** Brevo transactional email over the HTTP API (delivery webhooks available). */
export class BrevoMailer implements MailerProvider {
  readonly type = 'brevo';
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async send(options: MailerSendOptions): Promise<MailerSendResult> {
    const response = await axios.post(
      BREVO_API_URL,
      {
        sender: { name: options.fromName, email: options.fromEmail },
        to: [{ email: options.to }],
        subject: options.subject,
        htmlContent: options.html,
        textContent: options.text,
        replyTo: options.replyTo ? { email: options.replyTo } : undefined,
        headers: options.headers,
        tags: options.tags,
      },
      {
        headers: { 'api-key': this.apiKey },
        timeout: 15000,
      },
    );
    const data = response.data as { messageId?: string | number };
    return {
      providerMessageId: data?.messageId ? String(data.messageId) : undefined,
      raw: response.data,
    };
  }
}
