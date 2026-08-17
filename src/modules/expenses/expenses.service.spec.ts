/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { ExpensesService } from './expenses.service';

describe('ExpensesService', () => {
  const prisma = {
    expense: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  const service = new ExpensesService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('scopes active expenses and date filters to the user', async () => {
    prisma.expense.findMany.mockResolvedValue([]);
    await service.findAll('u1', {
      category: 'fuel',
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(prisma.expense.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: 'u1',
          deleted_at: null,
          category: 'fuel',
        }),
      }),
    );
  });

  it('soft deletes only an owned active expense', async () => {
    prisma.expense.findFirst.mockResolvedValue({ id: 'e1' });
    prisma.expense.update.mockResolvedValue({ id: 'e1' });
    await service.remove('u1', 'e1');
    expect(prisma.expense.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { deleted_at: expect.any(Date) },
    });
  });
});
