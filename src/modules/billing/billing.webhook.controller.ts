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

@ApiTags('Billing')
@Controller('billing/webhook')
export class BillingWebhookController {
  private readonly logger = new Logger(BillingWebhookController.name);

  constructor(private readonly billingService: BillingService) {}

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

    try {
      await this.billingService.processIdempotency(
        eventId,
        eventName,
        parsedPayload,
      );
    } catch {
      const existing = await this.billingService.findEvent(eventId);
      if (existing?.processed) {
        this.logger.log(`Duplicate event ${eventId}`);
        return { received: true };
      }
      this.logger.log(`Retrying previously failed event ${eventId}`);
    }

    try {
      const result = await this.billingService.processWebhook(
        eventName,
        parsedPayload,
      );

      await this.billingService.updateEvent(eventId, result.processed);

      return { received: true, processed: result.processed };
    } catch {
      this.logger.error(`Error processing webhook ${eventName}`);
      return { received: true, error: 'Processing failed' };
    }
  }
}
