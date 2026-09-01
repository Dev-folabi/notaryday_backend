/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  let service: AdminService;

  const prisma = {
    user: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    job: {
      count: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
    booking: { count: jest.fn() },
    invoice: { count: jest.fn() },
    expense: { count: jest.fn() },
    jobImport: {
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    lemonSqueezyEvent: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const queues: Record<string, any> = {
    jobImport: { name: 'job-import', getJobCounts: jest.fn() },
    invoice: { name: 'invoice', getJobCounts: jest.fn() },
    notification: { name: 'notification', getJobCounts: jest.fn() },
    calendar: { name: 'calendar-sync', getJobCounts: jest.fn() },
    billing: { name: 'billing-webhook', getJobCounts: jest.fn() },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: AuthService,
          useValue: { forgotPassword: jest.fn() },
        },
        { provide: 'BullQueue_job-import', useValue: queues.jobImport },
        { provide: 'BullQueue_invoice', useValue: queues.invoice },
        { provide: 'BullQueue_notification', useValue: queues.notification },
        { provide: 'BullQueue_calendar-sync', useValue: queues.calendar },
        { provide: 'BullQueue_billing-webhook', useValue: queues.billing },
      ],
    }).compile();
    service = module.get<AdminService>(AdminService);
  });

  describe('getOverview()', () => {
    it('aggregates user, job and ops counts', async () => {
      prisma.user.count
        .mockResolvedValueOnce(10) // totalUsers
        .mockResolvedValueOnce(2) // new7d
        .mockResolvedValueOnce(5) // new30d
        .mockResolvedValueOnce(3) // active7d
        .mockResolvedValueOnce(7) // active30d
        .mockResolvedValueOnce(6) // free
        .mockResolvedValueOnce(3) // pro
        .mockResolvedValueOnce(1); // pro annual
      prisma.job.count
        .mockResolvedValueOnce(40) // totalJobs
        .mockResolvedValueOnce(12) // jobs30d
        .mockResolvedValueOnce(1); // pendingReviewJobs
      prisma.booking.count.mockResolvedValueOnce(4);
      prisma.jobImport.count.mockResolvedValueOnce(2);
      prisma.invoice.count.mockResolvedValueOnce(1);
      prisma.lemonSqueezyEvent.count.mockResolvedValueOnce(0);
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      prisma.job.groupBy.mockResolvedValue([
        { status: 'CONFIRMED', _count: { _all: 5 } },
      ]);

      const result = await service.getOverview();

      expect(result.users.total).toBe(10);
      expect(result.users.byPlan).toEqual({
        FREE: 6,
        PRO: 3,
        PRO_ANNUAL: 1,
      });
      expect(result.jobs.total).toBe(40);
      expect(result.jobs.byStatus).toEqual([{ status: 'CONFIRMED', count: 5 }]);
      expect(result.ops.failedImports).toBe(2);
    });
  });

  describe('listUsers()', () => {
    it('applies search, pagination and returns meta', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'u1', email: 'a@b.c' }]);
      prisma.user.count.mockResolvedValue(25);

      const result = await service.listUsers({
        search: 'jane',
        page: 2,
        limit: 10,
      });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ OR: expect.any(Array) }),
          skip: 10,
          take: 10,
        }),
      );
      expect(result.meta).toEqual({
        page: 2,
        limit: 10,
        total: 25,
        totalPages: 3,
      });
    });
  });

  describe('updateUserPlan()', () => {
    it('updates plan and clears expiry when no date given', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.user.update.mockResolvedValue({ id: 'u1', plan: 'FREE' });

      await service.updateUserPlan('u1', 'FREE' as never);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { plan: 'FREE', plan_expires_at: null },
        select: expect.any(Object),
      });
    });

    it('throws NotFound for unknown user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.updateUserPlan('nope', 'PRO' as never),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('suspendUser()/restoreUser()', () => {
    it('soft-deletes and drops plan on suspend', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', deleted_at: null });
      await service.suspendUser('u1');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: expect.objectContaining({
          deleted_at: expect.any(Date),
          plan: 'FREE',
        }),
      });
    });

    it('rejects suspending an already suspended user', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        deleted_at: new Date(),
      });
      await expect(service.suspendUser('u1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('restores a suspended user', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        deleted_at: new Date(),
      });
      await service.restoreUser('u1');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { deleted_at: null },
      });
    });
  });

  describe('resetPassword()', () => {
    it('forwards to the auth password reset flow', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@b.c',
        deleted_at: null,
      });
      const result = await service.resetPassword('u1');
      expect(result).toEqual({ success: true });
    });

    it('rejects suspended users', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@b.c',
        deleted_at: new Date(),
      });
      await expect(service.resetPassword('u1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('systemHealth()', () => {
    it('returns per-queue counts and failure surfaces', async () => {
      queues.jobImport.getJobCounts.mockResolvedValue({ waiting: 2 });
      queues.invoice.getJobCounts.mockResolvedValue({ waiting: 0 });
      queues.notification.getJobCounts.mockResolvedValue({ waiting: 1 });
      queues.calendar.getJobCounts.mockResolvedValue({ waiting: 0 });
      queues.billing.getJobCounts.mockResolvedValue({ waiting: 0 });

      prisma.jobImport.count.mockResolvedValue(2);
      prisma.jobImport.groupBy.mockResolvedValue([
        { status: 'FAILED', _count: { _all: 2 } },
      ]);
      prisma.invoice.count.mockResolvedValue(1);
      prisma.lemonSqueezyEvent.findMany.mockResolvedValue([{ id: 'e1' }]);
      prisma.lemonSqueezyEvent.count
        .mockResolvedValueOnce(30) // total
        .mockResolvedValueOnce(3); // pending

      const result = await service.systemHealth();

      expect(result.queues['job-import']).toEqual({ waiting: 2 });
      expect(result.imports.failed).toBe(2);
      expect(result.invoices.emailFailures).toBe(1);
      expect(result.lemonsqueezy.total).toBe(30);
      expect(result.lemonsqueezy.pending).toBe(3);
    });
  });
});
