/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { InvoiceRetryCronService } from './invoice-retry-cron.service';

describe('InvoiceRetryCronService', () => {
  const prisma = { invoice: { findMany: jest.fn() } };
  const queue = { add: jest.fn() };
  const service = new InvoiceRetryCronService(prisma as never, queue as never);

  beforeEach(() => jest.clearAllMocks());

  it('enqueues the deterministic next attempt with Bull retries disabled', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      { id: 'inv-1', user_id: 'user-1', email_attempts: 1 },
    ]);

    await service.retryPendingEmails();

    expect(queue.add).toHaveBeenCalledWith(
      'send-email',
      { invoiceId: 'inv-1', userId: 'user-1', attempt: 2 },
      expect.objectContaining({ jobId: 'invoice-email-inv-1-2', attempts: 1 }),
    );
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          email_pending: true,
          email_attempts: { gte: 1, lt: 3 },
          email_last_error: { not: null },
          email_last_attempt_at: { lte: expect.any(Date) },
        }),
      }),
    );
  });

  it('relies on deterministic job IDs to deduplicate repeated cron runs', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      { id: 'inv-1', user_id: 'user-1', email_attempts: 1 },
    ]);
    await service.retryPendingEmails();
    await service.retryPendingEmails();

    expect(queue.add.mock.calls[0][2].jobId).toBe('invoice-email-inv-1-2');
    expect(queue.add.mock.calls[1][2].jobId).toBe('invoice-email-inv-1-2');
  });
});
