import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { BillingService, LemonSqueezyPayload } from './billing.service';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { QUEUE_BILLING_WEBHOOK } from '../../queues/queue.constants';

@ApiTags('Billing')
@Controller('billing/webhook')
export class BillingWebhookController {
  private readonly logger = new Logger(BillingWebhookController.name);

  constructor(
    private readonly billingService: BillingService,
    @InjectQueue(QUEUE_BILLING_WEBHOOK) private readonly billingQueue: Queue,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'LemonSqueezy webhook endpoint (server-to-server)' })
  @ApiHeader({
    name: 'x-signature',
    description: 'HMAC signature for payload verification',
    required: true,
  })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  @ApiResponse({ status: 401, description: 'Invalid signature' })
  @ApiResponse({ status: 400, description: 'Invalid JSON payload' })
  async handleWebhook(
    @Headers('x-signature') signature: string,
    @Body() rawBody: Buffer,
  ) {
    const payload = rawBody.toString('utf8');

    if (
      !signature ||
      !this.billingService.verifyWebhookSignature(payload, signature)
    ) {
      this.logger.warn('Invalid signature');
      throw new UnauthorizedException('Invalid signature');
    }

    let parsedPayload: LemonSqueezyPayload;
    try {
      parsedPayload = JSON.parse(payload) as LemonSqueezyPayload;
    } catch {
      this.logger.error('Invalid JSON payload');
      throw new BadRequestException('Invalid JSON payload');
    }

    const eventName =
      parsedPayload.meta?.event_name || parsedPayload.event_name;
    const eventId = parsedPayload.meta?.id || parsedPayload.id;

    if (!eventName || !eventId) {
      this.logger.warn('Missing event data');
      return { received: true };
    }

    const created = await this.billingService.persistWebhookEvent(
      eventId,
      eventName,
      parsedPayload,
    );
    if (!created) {
      this.logger.log(`Duplicate event ${eventId}`);
      return { received: true };
    }

    await this.billingQueue.add(
      'process-event',
      { eventId },
      {
        jobId: `billing-event-${eventId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );
    return { received: true, queued: true };
  }
}
