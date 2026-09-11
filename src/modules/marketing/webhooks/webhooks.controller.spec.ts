/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { RawBodyRequest, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import type { Request } from 'express';

import { WebhooksController } from './webhooks.controller';

function mockRequest(
  rawBody: string,
  query: Record<string, string> = {},
): RawBodyRequest<Request> {
  return {
    rawBody: Buffer.from(rawBody, 'utf8'),
    query,
  } as unknown as RawBodyRequest<Request>;
}

describe('WebhooksController', () => {
  const queueAdd = jest.fn().mockResolvedValue(undefined);
  const queue = { add: queueAdd } as never;
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'marketing.webhookSecretBrevo') return 'test-brevo-secret';
      if (key === 'marketing.webhookSecretResend') return '';
      if (key === 'NODE_ENV') return 'test';
      return undefined;
    }),
  } as unknown as ConfigService;

  const controller = new WebhooksController(config, queue);

  beforeEach(() => {
    jest.clearAllMocks();
    queueAdd.mockResolvedValue(undefined);
  });

  it('accepts a Brevo webhook authenticated with a Bearer token', async () => {
    const body = JSON.stringify({ event: 'delivered', email: 'a@b.com' });
    await expect(
      controller.brevo(
        mockRequest(body),
        'Bearer test-brevo-secret',
        undefined,
        {
          event: 'delivered',
          email: 'a@b.com',
        },
      ),
    ).resolves.toEqual({ received: true });
    expect(queueAdd).toHaveBeenCalledWith(
      'process-webhook-event',
      expect.objectContaining({
        event: expect.objectContaining({
          provider: 'brevo',
          type: 'DELIVERED',
        }),
      }),
    );
  });

  it('accepts a Brevo webhook authenticated with a URL query secret', async () => {
    const body = JSON.stringify({ event: 'opened', email: 'a@b.com' });
    await expect(
      controller.brevo(
        mockRequest(body, { secret: 'test-brevo-secret' }),
        undefined,
        undefined,
        { event: 'opened', email: 'a@b.com' },
      ),
    ).resolves.toEqual({ received: true });
    expect(queueAdd).toHaveBeenCalledWith(
      'process-webhook-event',
      expect.objectContaining({
        event: expect.objectContaining({ type: 'OPENED' }),
      }),
    );
  });

  it('accepts a legacy x-brevo-signature HMAC over the raw body', async () => {
    const body = JSON.stringify({ event: 'hard_bounce', email: 'a@b.com' });
    const sig = createHmac('sha256', 'test-brevo-secret')
      .update(Buffer.from(body, 'utf8'))
      .digest('hex');
    await expect(
      controller.brevo(mockRequest(body), undefined, sig, {
        event: 'hard_bounce',
        email: 'a@b.com',
      }),
    ).resolves.toEqual({ received: true });
    expect(queueAdd).toHaveBeenCalledWith(
      'process-webhook-event',
      expect.objectContaining({
        event: expect.objectContaining({ type: 'BOUNCED', hard: true }),
      }),
    );
  });

  it('rejects a Brevo webhook with no valid credential', async () => {
    const body = JSON.stringify({ event: 'delivered', email: 'a@b.com' });
    await expect(
      controller.brevo(mockRequest(body), undefined, undefined, {
        event: 'delivered',
        email: 'a@b.com',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('rejects a Brevo webhook with a wrong Bearer token', async () => {
    const body = JSON.stringify({ event: 'delivered', email: 'a@b.com' });
    await expect(
      controller.brevo(mockRequest(body), 'Bearer wrong', undefined, {
        event: 'delivered',
        email: 'a@b.com',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('normalizes soft_bounced / deferred / unique_opened / proxy_open', async () => {
    const cases: Array<[string, 'BOUNCED' | 'OPENED']> = [
      ['soft_bounced', 'BOUNCED'],
      ['deferred', 'BOUNCED'],
      ['unique_opened', 'OPENED'],
      ['proxy_open', 'OPENED'],
    ];
    for (const [event, expected] of cases) {
      queueAdd.mockClear();
      const body = JSON.stringify({ event, email: 'a@b.com' });
      await controller.brevo(
        mockRequest(body, { secret: 'test-brevo-secret' }),
        undefined,
        undefined,
        { event, email: 'a@b.com' },
      );
      expect(queueAdd).toHaveBeenCalledWith(
        'process-webhook-event',
        expect.objectContaining({
          event: expect.objectContaining({ type: expected }),
        }),
      );
    }
  });

  it('drops unrecognized Brevo event types', async () => {
    const body = JSON.stringify({ event: 'contact_updated', email: 'a@b.com' });
    await controller.brevo(
      mockRequest(body, { secret: 'test-brevo-secret' }),
      undefined,
      undefined,
      { event: 'contact_updated', email: 'a@b.com' },
    );
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('enqueues batched Brevo webhooks', async () => {
    const payload = [
      { event: 'delivered', email: 'a@b.com' },
      { event: 'click', email: 'b@c.com', link: 'https://x' },
    ];
    await controller.brevo(
      mockRequest(JSON.stringify(payload), { secret: 'test-brevo-secret' }),
      undefined,
      undefined,
      payload,
    );
    expect(queueAdd).toHaveBeenCalledTimes(2);
  });
});
