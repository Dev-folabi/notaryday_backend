import { Logger } from '@nestjs/common';
import { InjectQueue, Process, Processor } from '@nestjs/bull';
import type { Job, Queue } from 'bull';
import { QUEUE_MARKETING } from '../../queues/queue.constants';
import { ImportIngestService } from './services/import-ingest.service';
import { SendEmailService } from './services/send-email.service';
import { WebhookEventService } from './services/webhook-event.service';
import { ConversionService } from './services/conversion.service';
import type { NormalizedWebhookEvent } from '../../modules/marketing/webhooks/webhooks.controller';
import type { ConversionKind } from '../../modules/marketing/marketing.constants';

/**
 * Single consumer for QUEUE_MARKETING. All named job handlers live here —
 * BullMQ dispatches fetched jobs by name, so the queue must have exactly
 * one @Processor class covering every job name it produces.
 */
@Processor(QUEUE_MARKETING)
export class MarketingProcessor {
  private readonly logger = new Logger(MarketingProcessor.name);

  constructor(
    @InjectQueue(QUEUE_MARKETING) private readonly marketingQueue: Queue,
    private readonly ingest: ImportIngestService,
    private readonly send: SendEmailService,
    private readonly webhookEvents: WebhookEventService,
    private readonly conversions: ConversionService,
  ) {}

  @Process('import-file')
  async handleImport(job: Job<{ importId: string }>) {
    this.logger.log(
      `Picked up import-file job for ${job.data.importId} (attempt ${job.attemptsMade + 1})`,
    );
    await this.ingest.runImport(job.data.importId);
  }

  @Process('send-email')
  async handleSend(job: Job<{ recipientId: string }>) {
    const attempts = job.opts.attempts ?? 3;
    const isFinalAttempt = job.attemptsMade >= attempts - 1;
    try {
      await this.send.send(job.data.recipientId, isFinalAttempt);
    } catch (error) {
      if (isFinalAttempt) {
        // SendEmailService already recorded the failure on the final attempt
        this.logger.error(
          `send-email ${job.data.recipientId} failed permanently: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
      throw error;
    }
  }

  @Process('process-webhook-event')
  async handleWebhookEvent(job: Job<{ event: NormalizedWebhookEvent }>) {
    await this.webhookEvents.process(job.data.event);
  }

  @Process('lead-conversion')
  async handleLeadConversion(
    job: Job<{ email: string; userId?: string; kind: ConversionKind }>,
  ) {
    await this.conversions.process(job.data);
  }
}
