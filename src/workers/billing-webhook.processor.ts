import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import {
  BillingService,
  LemonSqueezyPayload,
} from '../modules/billing/billing.service';
import { QUEUE_BILLING_WEBHOOK } from '../queues/queue.constants';

@Processor(QUEUE_BILLING_WEBHOOK)
export class BillingWebhookProcessor {
  private readonly logger = new Logger(BillingWebhookProcessor.name);

  constructor(private readonly billingService: BillingService) {}

  @Process('process-event')
  async handleEvent(job: Job<{ eventId: string }>) {
    const event = await this.billingService.findEvent(job.data.eventId);
    if (!event || event.processed) return;

    try {
      const result = await this.billingService.processWebhook(
        event.event_name,
        event.payload as unknown as LemonSqueezyPayload,
      );
      if (!result.processed) {
        throw new Error(`Webhook event ${event.event_name} was not processed`);
      }
      await this.billingService.updateEvent(event.id, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.billingService.recordEventError(event.id, message);
      this.logger.error(`Billing event ${event.id} failed: ${message}`);
      throw error;
    }
  }
}
