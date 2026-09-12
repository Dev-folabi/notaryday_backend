import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { QUEUE_MARKETING } from '../../../queues/queue.constants';

/** Normalized webhook event handed to the marketing worker. */
export interface NormalizedWebhookEvent {
  provider: 'resend' | 'brevo';
  type:
    | 'DELIVERED'
    | 'BOUNCED'
    | 'COMPLAINED'
    | 'OPENED'
    | 'CLICKED'
    | 'UNSUBSCRIBED'
    | 'UNKNOWN';
  messageId?: string;
  email?: string;
  hard?: boolean;
  reason?: string;
  link?: string;
  raw: unknown;
}

/** Safely stringifies webhook payload fields (they arrive as `unknown`). */
function toStr(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return undefined;
}

/**
 * Delivery/engagement webhooks from email providers. Resend is verified
 * with Svix; Brevo does NOT sign its webhooks so verification is optional.
 */
@ApiTags('Marketing Webhooks')
@SkipThrottle()
@Controller('marketing/webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_MARKETING) private readonly marketingQueue: Queue,
  ) {}

  @Public()
  @Post('resend')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resend delivery events webhook (Svix signed)' })
  async resend(
    @Req() request: RawBodyRequest<Request>,
    @Headers('svix-id') svixId: string,
    @Headers('svix-timestamp') svixTimestamp: string,
    @Headers('svix-signature') svixSignature: string,
    @Body() body: Record<string, unknown>,
  ) {
    if (
      !request.rawBody ||
      !this.verifySvix(request.rawBody, svixId, svixTimestamp, svixSignature)
    ) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const type = toStr(body.type) ?? '';
    const data = (body.data ?? {}) as Record<string, unknown>;

    let normalized: NormalizedWebhookEvent['type'] = 'UNKNOWN';
    if (type === 'email.delivered') normalized = 'DELIVERED';
    else if (type === 'email.bounced') normalized = 'BOUNCED';
    else if (type === 'email.complained') normalized = 'COMPLAINED';
    else if (type === 'email.opened') normalized = 'OPENED';
    else if (type === 'email.clicked') normalized = 'CLICKED';

    const bounced = (data.bounced ?? {}) as Record<string, unknown>;
    const clicked = (data.clicked ?? {}) as Record<string, unknown>;

    const event: NormalizedWebhookEvent = {
      provider: 'resend',
      type: normalized,
      messageId: toStr(data.email_id),
      email: toStr(bounced.email) ?? toStr(data.to),
      hard: bounced.type
        ? toStr(bounced.type)?.toLowerCase() !== 'soft'
        : undefined,
      reason: toStr(bounced.reason),
      link: toStr(clicked.link),
      raw: body,
    };

    await this.enqueue(event);
    return { received: true };
  }

  @Public()
  @Post('brevo')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Brevo delivery events webhook (unsigned — no verification, shared secret optional)',
  })
  async brevo(
    @Req() request: RawBodyRequest<Request>,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Record<string, unknown> | Record<string, unknown>[],
  ) {
    if (!this.verifyBrevo(request, authorization)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const events = Array.isArray(body) ? body : [body];
    for (const item of events) {
      const event = this.normalizeBrevoEvent(item);
      if (event) await this.enqueue(event);
    }
    return { received: true };
  }

  private normalizeBrevoEvent(
    item: Record<string, unknown>,
  ): NormalizedWebhookEvent | null {
    const type = (toStr(item.event) ?? '').toLowerCase();
    let normalized: NormalizedWebhookEvent['type'] = 'UNKNOWN';
    let hard: boolean | undefined;
    switch (type) {
      case 'delivered':
      case 'requests':
        normalized = 'DELIVERED';
        break;
      case 'hard_bounce':
        normalized = 'BOUNCED';
        hard = true;
        break;
      case 'soft_bounce':
      case 'soft_bounced':
      case 'blocked':
      case 'invalid_email':
      case 'deferred':
        normalized = 'BOUNCED';
        hard = false;
        break;
      case 'spam':
        normalized = 'COMPLAINED';
        break;
      case 'opened':
      case 'open':
      case 'unique_opened':
      case 'proxy_open':
        normalized = 'OPENED';
        break;
      case 'click':
      case 'clicked':
        normalized = 'CLICKED';
        break;
      case 'unsubscribe':
        normalized = 'UNSUBSCRIBED';
        break;
      default:
        normalized = 'UNKNOWN';
    }
    if (normalized === 'UNKNOWN') return null;

    return {
      provider: 'brevo',
      type: normalized,
      messageId:
        toStr(item['message-id'])?.replace(/[<>]/g, '') ??
        toStr(item['sMessageId']),
      email: toStr(item.email)?.toLowerCase(),
      hard,
      reason: toStr(item.reason) ?? toStr(item['reason_text']),
      link: toStr(item.link),
      raw: item,
    };
  }

  private async enqueue(event: NormalizedWebhookEvent) {
    if (event.type === 'UNKNOWN') return;
    await Promise.race([
      this.marketingQueue.add('process-webhook-event', { event }),
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]).catch(() => undefined);
  }

  /** Svix (Resend) signature: HMAC-SHA256 over `${id}.${timestamp}.${payload}`. */
  private verifySvix(
    payload: Buffer,
    id: string,
    timestamp: string,
    signatureHeader: string,
  ): boolean {
    const secret = this.config.get<string>('marketing.webhookSecretResend', {
      infer: true,
    });
    if (!secret || !id || !timestamp || !signatureHeader) return false;

    const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    const toSign = `${id}.${timestamp}.${payload.toString('utf8')}`;
    const digest = createHmac('sha256', secretBytes)
      .update(toSign)
      .digest('base64');

    return signatureHeader.split(' ').some((part) => {
      const versioned = part.startsWith('v1,') ? part.slice(3) : null;
      if (!versioned) return false;
      const a = Buffer.from(versioned);
      const b = Buffer.from(digest);
      return a.length === b.length && timingSafeEqual(a, b);
    });
  }

  /**
   * Brevo does NOT sign its webhooks (no HMAC, no JWT — Brevo's own docs list
   * only Basic-auth-in-URL and IP allowlisting as hardening).
   * When a secret is configured, verify it via Bearer token or URL query param.
   */
  private verifyBrevo(
    request: RawBodyRequest<Request>,
    authorization: string | undefined,
  ): boolean {
    const secret =
      this.config.get<string>('marketing.webhookSecretBrevo', {
        infer: true,
      }) ?? '';

    // If no secret is configured, accept the webhook (no verification needed)
    if (!secret) return true;

    // (1) Bearer token
    const auth = authorization?.trim() ?? '';
    if (auth.startsWith('Bearer ')) {
      return this.timingSafe(auth.slice(7).trim(), secret);
    }

    // (2) Basic auth (Brevo supports Basic-auth-in-URL)
    if (auth.startsWith('Basic ')) {
      return this.timingSafe(auth.slice(6).trim(), secret);
    }

    // (3) URL query secret
    const urlSecret = (request.query?.secret as string | undefined) ?? '';
    if (urlSecret) return this.timingSafe(urlSecret, secret);

    return false;
  }

  private timingSafe(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }
}
