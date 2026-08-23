import { BillingWebhookProcessor } from './billing-webhook.processor';

describe('BillingWebhookProcessor', () => {
  const billing = {
    findEvent: jest.fn(),
    processWebhook: jest.fn(),
    updateEvent: jest.fn(),
    recordEventError: jest.fn(),
  };
  const processor = new BillingWebhookProcessor(billing as never);

  beforeEach(() => {
    jest.clearAllMocks();
    billing.findEvent.mockResolvedValue({
      id: 'evt-1',
      event_name: 'subscription_created',
      payload: {},
      processed: false,
    });
  });

  it('marks an event processed only after success', async () => {
    billing.processWebhook.mockResolvedValue({ processed: true });
    await processor.handleEvent({ data: { eventId: 'evt-1' } } as never);
    expect(billing.updateEvent).toHaveBeenCalledWith('evt-1', true);
    expect(billing.recordEventError).not.toHaveBeenCalled();
  });

  it('stores the error and rethrows for Bull retries', async () => {
    billing.processWebhook.mockRejectedValue(new Error('transient'));
    await expect(
      processor.handleEvent({ data: { eventId: 'evt-1' } } as never),
    ).rejects.toThrow('transient');
    expect(billing.recordEventError).toHaveBeenCalledWith('evt-1', 'transient');
    expect(billing.updateEvent).not.toHaveBeenCalled();
  });

  it('does nothing for an already processed duplicate', async () => {
    billing.findEvent.mockResolvedValue({ id: 'evt-1', processed: true });
    await processor.handleEvent({ data: { eventId: 'evt-1' } } as never);
    expect(billing.processWebhook).not.toHaveBeenCalled();
  });
});
