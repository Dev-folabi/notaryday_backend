import { Logger } from '@nestjs/common';
import { BrevoMailer } from '../marketing/mailer/brevo.mailer';
import {
  TransactionalMailer,
  TransactionalProviderType,
  TransactionalSendOptions,
  TransactionalSendResult,
} from './interface';
import { normalizeFromAddress } from '../../common/email/normalize-from-address.util';

/**
 * Brevo adapter for transactional (non-marketing) email sends.
 * Wraps the existing marketing BrevoMailer and splits the normalized
 * from address into Brevo's sender { name, email } structure.
 */
export class BrevoTransactionalMailer implements TransactionalMailer {
  readonly provider: TransactionalProviderType = 'brevo';
  private readonly logger = new Logger(BrevoTransactionalMailer.name);
  private mailer: BrevoMailer | null = null;
  private readonly from: ReturnType<typeof normalizeFromAddress>;

  constructor(
    private readonly apiKey: string,
    fromAddress: string,
  ) {
    this.from = normalizeFromAddress(fromAddress, this.logger);
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  getFromEmail(): string {
    return this.from.email;
  }

  private getMailer(): BrevoMailer {
    if (!this.mailer) {
      this.mailer = new BrevoMailer(this.apiKey);
    }
    return this.mailer;
  }

  async send(
    options: TransactionalSendOptions,
  ): Promise<TransactionalSendResult> {
    if (!this.isConfigured()) {
      throw new Error('BREVO_API_KEY is not configured');
    }

    const result = await this.getMailer().send({
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      fromName: this.from.name,
      fromEmail: this.from.email,
    });

    return {
      provider: this.provider,
      messageId: result.providerMessageId,
    };
  }
}
