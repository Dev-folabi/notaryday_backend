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
import { BillingService, LemonSqueezyPayload } from './billing.service';

@Controller('billing/webhook')
export class BillingWebhookController {
  private readonly logger = new Logger(BillingWebhookController.name);

  constructor(private readonly billingService: BillingService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Headers('x-signature') signature: string,
    @Body() rawBody: Buffer,
  ) {
    // rawBody is expected to be a Buffer (requires raw-body middleware/NestJS config)
    const payload = rawBody.toString('utf8');

    // Verify webhook signature
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

    // Atomic idempotency check and creation
    try {
      await this.billingService.processIdempotency(
        eventId,
        eventName,
        parsedPayload,
      );
    } catch {
      this.logger.log(`Duplicate event ${eventId}`);
      return { received: true };
    }

    // Process the webhook
    try {
      const result = await this.billingService.processWebhook(
        eventName,
        parsedPayload,
      );

      // Update event status
      await this.billingService.updateEvent(eventId, result.processed);

      return { received: true, processed: result.processed };
    } catch {
      this.logger.error(`Error processing webhook ${eventName}`);
      return { received: true, error: 'Processing failed' };
    }
  }
}
