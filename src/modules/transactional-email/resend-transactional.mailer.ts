import { Logger } from '@nestjs/common';
import { Resend } from 'resend';
import {
  TransactionalMailer,
  TransactionalProviderType,
  TransactionalSendOptions,
  TransactionalSendResult,
} from './interface';
import { normalizeFromAddress } from '../../common/email/normalize-from-address.util';

/**
 * Resend adapter for transactional (non-marketing) email sends.
 * Lazily creates the Resend client so the service can boot without a key.
 */
export class ResendTransactionalMailer implements TransactionalMailer {
  readonly provider: TransactionalProviderType = 'resend';
  private readonly logger = new Logger(ResendTransactionalMailer.name);
  private resend: Resend | null = null;
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

  private getClient(): Resend {
    if (!this.resend) {
      this.resend = new Resend(this.apiKey);
    }
    return this.resend;
  }

  async send(
    options: TransactionalSendOptions,
  ): Promise<TransactionalSendResult> {
    if (!this.isConfigured()) {
      throw new Error('RESEND_API_KEY is not configured');
    }

    const { data, error } = await this.getClient().emails.send({
      from: this.from.formatted,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    if (error) {
      throw new Error(`Resend error: ${error.message}`);
    }

    return {
      provider: this.provider,
      messageId: data?.id,
    };
  }
}
