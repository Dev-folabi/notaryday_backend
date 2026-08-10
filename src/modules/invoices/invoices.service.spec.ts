import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { PrismaService } from '../../config/prisma.service';
import { UserSettingsService } from '../users/user-settings.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('InvoicesService', () => {
  let service: InvoicesService;
  let prisma: { invoice: { update: jest.Mock } };
  let enqueue: jest.SpyInstance;

  const baseInvoice = {
    id: 'inv-1',
    user_id: 'u1',
    job_id: 'j1',
    travel_fee: 10,
    is_paid: false,
    sent_at: null,
  };

  beforeEach(async () => {
    prisma = {
      invoice: {
        update: jest.fn().mockResolvedValue({ id: 'inv-1' }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: PrismaService, useValue: prisma },
        { provide: UserSettingsService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: 'BullQueue_invoice', useValue: { add: jest.fn() } },
      ],
    }).compile();

    service = module.get<InvoicesService>(InvoicesService);
    enqueue = jest.spyOn(
      service as unknown as { enqueue: () => void },
      'enqueue',
    );
    enqueue.mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('update()', () => {
    it('allows full edit of a draft invoice', async () => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValue({ ...baseInvoice } as never);

      await service.update('u1', 'inv-1', {
        recipient_name: 'New Client',
        final_fee: 150,
        note_to_client: 'Thanks',
      });

      expect(prisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({
            recipient_name: 'New Client',
            subtotal: 150,
            total: 160,
          }),
        }),
      );
    });

    it('allows full edit of a sent (unpaid) invoice', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        ...baseInvoice,
        sent_at: new Date('2026-01-01'),
      } as never);

      await expect(
        service.update('u1', 'inv-1', { final_fee: 200 }),
      ).resolves.toBeDefined();
    });

    it('rejects final_fee changes on a paid invoice', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        ...baseInvoice,
        is_paid: true,
      } as never);

      await expect(
        service.update('u1', 'inv-1', { final_fee: 200 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows non-financial edits on a paid invoice', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        ...baseInvoice,
        is_paid: true,
      } as never);

      await expect(
        service.update('u1', 'inv-1', { recipient_email: 'x@y.com' }),
      ).resolves.toBeDefined();
    });
  });
});
