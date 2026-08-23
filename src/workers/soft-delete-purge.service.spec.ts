import { SoftDeletePurgeService } from './soft-delete-purge.service';

describe('SoftDeletePurgeService', () => {
  const calls: string[] = [];
  const delegate = (name: string) => ({
    deleteMany: jest.fn(() => {
      calls.push(name);
      return Promise.resolve({ count: 0 });
    }),
  });
  const prisma = {
    job: delegate('job'),
    booking: delegate('booking'),
    invoice: delegate('invoice'),
    expense: delegate('expense'),
    mileageEntry: delegate('mileageEntry'),
    journalEntry: delegate('journalEntry'),
    user: delegate('user'),
  };
  const config = { get: jest.fn().mockReturnValue(90) };
  const service = new SoftDeletePurgeService(prisma as never, config as never);

  beforeEach(() => {
    calls.length = 0;
    jest.clearAllMocks();
  });

  it('uses the retention cutoff and purges users last', async () => {
    jest
      .useFakeTimers()
      .setSystemTime(new Date('2026-08-17T12:00:00Z').getTime());
    await service.purge();
    jest.useRealTimers();

    expect(calls).toEqual([
      'invoice',
      'job',
      'booking',
      'expense',
      'mileageEntry',
      'journalEntry',
      'user',
    ]);
    expect(prisma.job.deleteMany).toHaveBeenCalledWith({
      where: { deleted_at: { lt: new Date('2026-05-19T12:00:00Z') } },
    });
    expect(prisma.booking.deleteMany).toHaveBeenCalledWith({
      where: {
        deleted_at: { lt: new Date('2026-05-19T12:00:00Z') },
        job: null,
      },
    });
  });

  it('stops before users when an earlier purge fails', async () => {
    prisma.expense.deleteMany.mockRejectedValueOnce(new Error('database down'));
    await expect(service.purge()).rejects.toThrow('database down');
    expect(prisma.user.deleteMany).not.toHaveBeenCalled();
  });
});
