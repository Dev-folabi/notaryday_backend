import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { PrismaService } from '../../config/prisma.service';
import { UserSettingsService } from '../users/user-settings.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('InvoicesService', () => {
  let service: InvoicesService;
  let prisma: {
    invoice: {
      update: jest.Mock;
      findFirst: jest.Mock;
    };
  };
  let enqueue: jest.SpyInstance;

  const baseInvoice = {
    id: 'inv-1',
    user_id: 'u1',
    job_id: 'j1',
    subtotal: 100,
    travel_fee: 10,
    total: 110,
    is_paid: false,
    sent_at: null,
    email_pending: false,
  };

  beforeEach(async () => {
    prisma = {
      invoice: {
        update: jest.fn().mockResolvedValue({ id: 'inv-1' }),
        findFirst: jest.fn().mockResolvedValue(null),
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
            travel_fee: 0,
            total: 150,
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

  describe('syncDraftFromJob()', () => {
    it('syncs fee + travel amount on an unpaid draft', async () => {
      prisma.invoice.findFirst.mockResolvedValue(baseInvoice);

      await service.syncDraftFromJob('u1', 'j1', {
        fee: 150,
        mileage_cost: 20,
      });

      expect(prisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({
            subtotal: 150,
            travel_fee: 20,
            total: 170,
          }),
        }),
      );
      expect(enqueue).toHaveBeenCalledWith('generate-pdf', {
        invoiceId: 'inv-1',
        userId: 'u1',
        reason: 'fee-edit-sync',
      });
    });

    it('syncs a sent (emailed, unpaid) invoice too', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        ...baseInvoice,
        sent_at: new Date('2026-01-01'),
      });

      await service.syncDraftFromJob('u1', 'j1', { fee: 200, mileage_cost: 0 });

      expect(prisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({
            subtotal: 200,
            travel_fee: 0,
            total: 200,
          }),
        }),
      );
    });

    it('skips syncing a paid invoice', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        ...baseInvoice,
        is_paid: true,
      });

      await service.syncDraftFromJob('u1', 'j1', { fee: 999, mileage_cost: 9 });

      expect(prisma.invoice.update).not.toHaveBeenCalled();
    });

    it('syncs client name and email on an unpaid invoice when updated', async () => {
      prisma.invoice.findFirst.mockResolvedValue(baseInvoice);

      await service.syncDraftFromJob('u1', 'j1', {
        fee: 100,
        mileage_cost: 10,
        client_name: 'Updated Client Name',
        client_email: 'newclient@example.com',
      });

      expect(prisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data: expect.objectContaining({
            recipient_name: 'Updated Client Name',
            recipient_email: 'newclient@example.com',
          }),
        }),
      );
    });

    it('does nothing when unchanged or no invoice exists', async () => {
      prisma.invoice.findFirst.mockResolvedValue(baseInvoice);
      await service.syncDraftFromJob('u1', 'j1', {
        fee: 100,
        mileage_cost: 10,
      });

      prisma.invoice.findFirst.mockResolvedValue(null);
      await service.syncDraftFromJob('u1', 'j1', { fee: 500, mileage_cost: 5 });

      expect(prisma.invoice.update).not.toHaveBeenCalled();
    });
  });
});
