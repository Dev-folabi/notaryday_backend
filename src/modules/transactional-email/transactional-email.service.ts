import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../config/prisma.service';
import { BrevoTransactionalMailer } from './brevo-transactional.mailer';
import { ResendTransactionalMailer } from './resend-transactional.mailer';
import {
  TransactionalMailer,
  TransactionalProviderType,
  TransactionalSendOptions,
  TransactionalSendResult,
  ProviderStatus,
} from './interface';

const CACHE_TTL_MS = 30_000;
const SYSTEM_SETTING_KEY = 'transactional_email_provider';

@Injectable()
export class TransactionalEmailService {
  private readonly logger = new Logger(TransactionalEmailService.name);

  private cachedProvider: TransactionalProviderType | null = null;
  private cacheExpiry = 0;

  private resendMailer: ResendTransactionalMailer | null = null;
  private brevoMailer: BrevoTransactionalMailer | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private getResendMailer(): ResendTransactionalMailer {
    if (!this.resendMailer) {
      const apiKey = this.config.get<string>('RESEND_API_KEY') ?? '';
      const from = this.config.get<string>('RESEND_FROM_ADDRESS') ?? '';
      this.resendMailer = new ResendTransactionalMailer(apiKey, from);
    }
    return this.resendMailer;
  }

  private getBrevoMailer(): BrevoTransactionalMailer {
    if (!this.brevoMailer) {
      const apiKey = this.config.get<string>('BREVO_API_KEY') ?? '';
      const from = this.config.get<string>('BREVO_FROM_ADDRESS') ?? '';
      this.brevoMailer = new BrevoTransactionalMailer(apiKey, from);
    }
    return this.brevoMailer;
  }

  private getMailer(type: TransactionalProviderType): TransactionalMailer {
    return type === 'resend' ? this.getResendMailer() : this.getBrevoMailer();
  }

  /** Reads the active provider from DB with a 30s cache. Falls back to 'resend' if unset. */
  async getActiveProvider(): Promise<TransactionalProviderType> {
    const now = Date.now();
    if (this.cachedProvider && now < this.cacheExpiry) {
      return this.cachedProvider;
    }

    const setting = await this.prisma.systemSettings.findUnique({
      where: { key: SYSTEM_SETTING_KEY },
    });
    const provider: TransactionalProviderType =
      setting?.value === 'brevo' && this.getBrevoMailer().isConfigured()
        ? 'brevo'
        : 'resend';

    this.cachedProvider = provider;
    this.cacheExpiry = now + CACHE_TTL_MS;
    return provider;
  }

  /** Send via active provider, falling back to the other provider on failure. */
  async send(
    options: TransactionalSendOptions,
  ): Promise<TransactionalSendResult> {
    const active = await this.getActiveProvider();
    const fallback = active === 'resend' ? 'brevo' : 'resend';

    const activeMailer = this.getMailer(active);
    if (!activeMailer.isConfigured()) {
      this.logger.warn(
        `Active provider "${active}" is not configured; trying fallback "${fallback}"`,
      );
      return this.sendVia(fallback, options);
    }

    try {
      return await activeMailer.send(options);
    } catch (error) {
      const activeMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Active provider "${active}" failed (${activeMsg}); falling back to "${fallback}"`,
      );
      try {
        return await this.sendVia(fallback, options);
      } catch (fallbackError) {
        const fallbackMsg =
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError);
        throw new Error(
          `Transactional email send failed on all providers.\n` +
            `Active (${active}): ${activeMsg}\n` +
            `Fallback (${fallback}): ${fallbackMsg}`,
        );
      }
    }
  }

  private async sendVia(
    type: TransactionalProviderType,
    options: TransactionalSendOptions,
  ): Promise<TransactionalSendResult> {
    const mailer = this.getMailer(type);
    if (!mailer.isConfigured()) {
      throw new Error(`Provider "${type}" is not configured (missing API key)`);
    }
    return mailer.send(options);
  }

  /** Send a test email via a specific provider (for admin health check). */
  async testProvider(
    type: TransactionalProviderType,
    options: TransactionalSendOptions,
  ): Promise<TransactionalSendResult> {
    const mailer = this.getMailer(type);
    if (!mailer.isConfigured()) {
      throw new Error(`Provider "${type}" is not configured (missing API key)`);
    }
    return mailer.send(options);
  }

  /** Return provider status info for the admin dashboard. */
  async getProviderStatus(): Promise<{
    providers: ProviderStatus[];
    active: TransactionalProviderType;
  }> {
    const active = await this.getActiveProvider();
    return {
      active,
      providers: [
        {
          type: 'resend',
          label: 'Resend',
          configured: this.getResendMailer().isConfigured(),
          fromEmail: this.getResendMailer().getFromEmail(),
        },
        {
          type: 'brevo',
          label: 'Brevo',
          configured: this.getBrevoMailer().isConfigured(),
          fromEmail: this.getBrevoMailer().getFromEmail(),
        },
      ],
    };
  }

  /** Invalidate the provider cache (e.g. after a settings update). */
  clearCache(): void {
    this.cachedProvider = null;
    this.cacheExpiry = 0;
  }
}
