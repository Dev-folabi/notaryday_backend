import { BillingWebhookController } from './billing.webhook.controller';

describe('BillingWebhookController', () => {
  const billing = {
    verifyWebhookSignature: jest.fn().mockReturnValue(true),
    persistWebhookEvent: jest.fn(),
  };
  const queue = { add: jest.fn() };
  const controller = new BillingWebhookController(
    billing as never,
    queue as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('persists before enqueueing a deterministic three-attempt job', async () => {
    billing.persistWebhookEvent.mockResolvedValue(true);
    const payload = Buffer.from(
      JSON.stringify({
        id: 'evt-1',
        event_name: 'subscription_created',
        data: { id: 'sub-1', attributes: {} },
      }),
    );

    await expect(controller.handleWebhook('sig', payload)).resolves.toEqual({
      received: true,
      queued: true,
    });
    expect(
      billing.persistWebhookEvent.mock.invocationCallOrder[0],
    ).toBeLessThan(queue.add.mock.invocationCallOrder[0]);
    expect(queue.add).toHaveBeenCalledWith(
      'process-event',
      { eventId: 'evt-1' },
      {
        jobId: 'billing-event-evt-1',
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );
  });

  it('treats duplicates as no-ops', async () => {
    billing.persistWebhookEvent.mockResolvedValue(false);
    const payload = Buffer.from(
      JSON.stringify({
        id: 'evt-1',
        event_name: 'subscription_created',
        data: { id: 'sub-1', attributes: {} },
      }),
    );
    await expect(controller.handleWebhook('sig', payload)).resolves.toEqual({
      received: true,
    });
    expect(queue.add).not.toHaveBeenCalled();
  });
});
