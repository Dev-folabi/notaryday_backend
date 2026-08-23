/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Prisma } from '../../../generated/prisma';
import { BillingService } from './billing.service';

describe('BillingService', () => {
  const prisma = {
    lemonSqueezyEvent: { create: jest.fn(), update: jest.fn() },
  };
  const service = new BillingService(
    { get: jest.fn() } as never,
    prisma as never,
    {} as never,
    {} as never,
    { track: jest.fn() } as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('persists a new webhook event as unprocessed', async () => {
    prisma.lemonSqueezyEvent.create.mockResolvedValue({ id: 'evt-1' });
    await expect(
      service.persistWebhookEvent('evt-1', 'subscription_created', {
        data: { id: 'sub-1', type: 'subscriptions', attributes: {} as never },
      }),
    ).resolves.toBe(true);
    expect(prisma.lemonSqueezyEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: 'evt-1', processed: false }),
    });
  });

  it('returns false for a duplicate event', async () => {
    prisma.lemonSqueezyEvent.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '7.6.0',
      }),
    );
    await expect(
      service.persistWebhookEvent('evt-1', 'subscription_created', {
        data: { id: 'sub-1', type: 'subscriptions', attributes: {} as never },
      }),
    ).resolves.toBe(false);
  });

  it('records worker errors without marking the event processed', async () => {
    prisma.lemonSqueezyEvent.update.mockResolvedValue({});
    await service.recordEventError('evt-1', 'transient');
    expect(prisma.lemonSqueezyEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: { error: 'transient', processed: false, processed_at: null },
    });
  });
});
