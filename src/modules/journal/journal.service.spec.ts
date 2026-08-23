/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { JournalService } from './journal.service';

describe('JournalService', () => {
  const prisma = {
    journalEntry: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const service = new JournalService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('does not duplicate the journal entry for a completed job', async () => {
    const existing = { id: 'entry-1' };
    prisma.journalEntry.findFirst.mockResolvedValue(existing);
    await expect(
      service.createForCompletedJob('u1', {
        id: 'job-1',
        appointment_time: new Date('2026-08-17T14:05:00Z'),
        address: '1 Main St',
        client_name: 'Client',
        fee: '100' as never,
        signing_type: 'GENERAL' as never,
        notes: null,
      }),
    ).resolves.toBe(existing);
    expect(prisma.journalEntry.create).not.toHaveBeenCalled();
  });

  it('sanitizes journal text before persistence', async () => {
    prisma.journalEntry.create.mockResolvedValue({ id: 'entry-1' });
    await service.create('u1', {
      entry_date: '2026-08-17',
      act_type: '<script>x</script>',
      signer_name: 'Client',
    } as never);
    expect(prisma.journalEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: 'u1',
          act_type: expect.not.stringContaining('<script>'),
        }),
      }),
    );
  });
});
