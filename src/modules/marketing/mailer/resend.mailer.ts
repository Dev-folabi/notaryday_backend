import { Resend } from 'resend';
import {
  MailerProvider,
  MailerSendOptions,
  MailerSendResult,
} from './mailer-provider.interface';

export class ResendMailer implements MailerProvider {
  readonly type = 'resend';
  private readonly client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(options: MailerSendOptions): Promise<MailerSendResult> {
    const payload: Record<string, unknown> = {
      from: `${options.fromName} <${options.fromEmail}>`,
      to: [options.to],
      subject: options.subject,
    };
    if (options.html) payload.html = options.html;
    if (options.text) payload.text = options.text;
    if (options.replyTo) payload.replyTo = options.replyTo;
    if (options.headers) payload.headers = options.headers;
    if (options.tags) {
      payload.tags = options.tags.map((t) => ({ name: 'tag', value: t }));
    }

    const { data, error } = await this.client.emails.send(
      payload as unknown as Parameters<typeof this.client.emails.send>[0],
    );
    if (error) {
      throw new Error(`Resend error: ${error.message}`);
    }
    return { providerMessageId: data?.id, raw: data };
  }
}
