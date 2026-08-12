import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReportsService } from './reports.service';
import { PrismaService } from '../../config/prisma.service';
import { JobStatus } from '../../../generated/prisma';

describe('ReportsService', () => {
  let service: ReportsService;
  let prisma: {
    job: { findMany: jest.Mock };
    mileageEntry: {
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findFirst: jest.Mock;
    };
    userSettings: { findUnique: jest.Mock };
    expense: { findMany: jest.Mock };
    journalEntry: { count: jest.Mock };
    user: { findUnique: jest.Mock };
  };

  const job = (overrides: Record<string, unknown> = {}) => ({
    id: 'j1',
    user_id: 'u1',
    deleted_at: null,
    status: JobStatus.COMPLETE,
    appointment_time: new Date('2026-03-15'),
    fee: 150,
    platform_fee: 0,
    mileage_cost: 30,
    mileage_miles: 45,
    signing_duration_mins: 60,
    scanback_duration_mins: 0,
    drive_from_prev_mins: 0,
    signing_type: 'loan_refi',
    platform_name: 'Snapdocs',
    client_name: null,
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      job: { findMany: jest.fn().mockResolvedValue([]) },
      mileageEntry: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'm1' }),
        update: jest.fn().mockResolvedValue({ id: 'm1' }),
        findFirst: jest.fn().mockResolvedValue({ id: 'm1' }),
      },
      userSettings: {
        findUnique: jest.fn().mockResolvedValue({ irs_rate_per_mile: 0.67 }),
      },
      expense: { findMany: jest.fn().mockResolvedValue([]) },
      journalEntry: { count: jest.fn().mockResolvedValue(0) },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { get: jest.fn(() => undefined) },
        },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('earnings()', () => {
    it('groups by type with miles and avg per signing', async () => {
      prisma.job.findMany.mockResolvedValue([
        job({ fee: 200, mileage_cost: 20, mileage_miles: 30 }),
        job({
          signing_type: 'general',
          fee: 100,
          mileage_cost: 0,
          mileage_miles: 0,
        }),
      ]);

      const res = await service.earnings('u1', '2026-01-01', '2026-12-31');
      const byType = res.byType as Array<{
        signing_type: string;
        count: number;
        gross: number;
        net: number;
        miles: number;
        avg: number;
      }>;
      expect(res.summary.gross).toBe(300);
      expect(byType).toHaveLength(2);

      const loan = byType.find((t) => t.signing_type === 'loan_refi');
      expect(loan).toMatchObject({
        count: 1,
        gross: 200,
        net: 180,
        miles: 30,
        avg: 200,
      });
    });

    it('computes YoY pct vs the same period last year', async () => {
      prisma.job.findMany
        .mockResolvedValueOnce([job({ fee: 300 })])
        .mockResolvedValueOnce([job({ fee: 200 })]);

      const res = (await service.earnings(
        'u1',
        '2026-01-01',
        '2026-01-31',
        'month',
        true,
      )) as { yoy: { gross: number; grossPct: number; netPct: number } };
      expect(res.yoy.gross).toBe(200);
      expect(res.yoy.grossPct).toBe(50);
      expect(res.yoy.netPct).toBe(58.8);
    });
  });

  describe('mileage()', () => {
    it('merges auto (jobs) and manual entries with method tags', async () => {
      prisma.job.findMany.mockResolvedValue([job()]);
      prisma.mileageEntry.findMany.mockResolvedValue([
        {
          id: 'm1',
          miles_date: new Date('2026-03-10'),
          description: 'Lender meeting',
          miles: 10,
        },
      ]);

      const res = await service.mileage('u1', 2026);
      expect(res.totalMiles).toBe(55);
      expect(res.totalDeduction).toBeCloseTo(36.7);
      expect(res.autoMiles).toBe(45);
      expect(res.manualMiles).toBe(10);

      const entries = res.entries as Array<{
        id?: string;
        job: string;
        miles: number;
        method: 'auto' | 'manual';
      }>;
      const manual = entries.find((e) => e.method === 'manual');
      expect(manual).toMatchObject({
        id: 'm1',
        job: 'Lender meeting',
        miles: 10,
      });
      const auto = entries.find((e) => e.method === 'auto')!;
      expect(auto.id).toBeUndefined();
    });
  });

  describe('mileage CRUD', () => {
    it('creates a manual entry', async () => {
      await service.createMileageEntry('u1', {
        miles_date: '2026-03-10',
        miles: 12.5,
        description: 'Trip',
      });
      expect(prisma.mileageEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id: 'u1',
            miles: 12.5,
          }) as never,
        }) as never,
      );
    });

    it('throws NotFound when updating a missing entry', async () => {
      prisma.mileageEntry.findFirst.mockResolvedValue(null);
      await expect(
        service.updateMileageEntry('u1', 'nope', { miles: 5 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('taxReport()', () => {
    it('returns byType and mileage detail grouped by range', async () => {
      prisma.job.findMany.mockResolvedValue([job()]);
      prisma.mileageEntry.findMany.mockResolvedValue([
        {
          id: 'm1',
          miles_date: new Date('2026-03-10'),
          description: 'Manual',
          miles: 25,
        },
      ]);
      prisma.expense.findMany.mockResolvedValue([
        { category: 'Software', amount: 10 },
      ]);

      const res = await service.taxReport('u1', '2026-01-01', '2026-12-31');
      expect(res.income.gross).toBe(150);
      expect(res.expenses.total).toBe(10);
      expect(res.mileage.totalMiles).toBe(70);
      expect(res.mileage.autoMiles).toBe(45);
      expect(res.mileage.manualMiles).toBe(25);
      expect(res.byType).toHaveLength(1);
    });
  });
});
