import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { QUEUE_MARKETING } from '../../../queues/queue.constants';
import { ConversionKind } from '../marketing.constants';

export interface LeadConversionEvent {
  email: string;
  userId?: string;
  kind: ConversionKind;
}

/**
 * Tiny fire-and-forget emitter for lead-conversion events onto the marketing
 * queue. Imported by Auth/Citt/Billing modules — no Mongo dependency, so
 * those modules stay bootable when the marketing DB is down.
 */
@Injectable()
export class MarketingEventsEmitter {
  private readonly logger = new Logger(MarketingEventsEmitter.name);

  constructor(@InjectQueue(QUEUE_MARKETING) private readonly queue: Queue) {}

  conversion(event: LeadConversionEvent): void {
    void Promise.race([
      this.queue.add('lead-conversion', event, {
        jobId: `conv-${event.kind}-${event.email.toLowerCase()}`,
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]).catch((error) => {
      this.logger.warn(
        `Failed to enqueue conversion event for ${event.email}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
}
