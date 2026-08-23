import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostHog } from 'posthog-node';

export type AnalyticsEvent =
  | 'user_registered'
  | 'job_created'
  | 'job_completed'
  | 'citt_checked'
  | 'booking_requested'
  | 'booking_approved'
  | 'job_import_completed'
  | 'invoice_sent'
  | 'subscription_changed';

/**
 * Explicit, privacy-safe product analytics. Emits only named events with
 * sanitized properties (no PII, no raw email/address payloads). No-op when
 * POSTHOG_ENABLED=false or POSTHOG_API_KEY is empty, so it is safe to run
 * in every environment.
 */
@Injectable()
export class AnalyticsService implements OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly client: PostHog | null;

  constructor(private readonly config: ConfigService) {
    const enabled = this.config.get<boolean>('POSTHOG_ENABLED');
    const key = this.config.get<string>('POSTHOG_API_KEY');

    if (enabled && key) {
      const host =
        this.config.get<string>('POSTHOG_HOST') ?? 'https://us.i.posthog.com';
      this.client = new PostHog(key, {
        host,
        flushAt: 20,
        flushInterval: 10_000,
      });
      this.logger.log('PostHog analytics enabled');
    } else {
      this.client = null;
    }
  }

  track(
    event: AnalyticsEvent,
    distinctId: string,
    properties: Record<string, unknown> = {},
  ): void {
    if (!this.client) return;
    try {
      this.client.capture({
        distinctId,
        event,
        properties: {
          ...properties,
          environment: this.config.get<string>('NODE_ENV') ?? 'development',
        },
      });
    } catch (err) {
      this.logger.warn(
        `PostHog capture failed for ${event}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client._shutdown(2000);
    } catch (err) {
      this.logger.warn(
        `PostHog shutdown failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
