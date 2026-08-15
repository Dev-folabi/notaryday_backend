import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { JobsService } from './jobs.service';
import { PrismaService } from '../../config/prisma.service';
import { RedisService } from '../../config/redis.service';
import { GeocodingService } from '../geocoding/geocoding.service';
import { UserSettingsService } from '../users/user-settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { JournalService } from '../journal/journal.service';
import { OrsService } from '../../common/services/ors.service';
import { InvoicesService } from '../invoices/invoices.service';
import {
  QUEUE_CALENDAR_SYNC,
  QUEUE_NOTIFICATION,
} from '../../queues/queue.constants';
import { JobSource, JobStatus } from '../../../generated/prisma';
import type { CreateJobDto } from './dto/create-job.dto';

interface CreatedJobData {
  mileage_miles?: number | null;
  mileage_cost?: number | null;
  effective_hourly?: number | null;
}

describe('JobsService', () => {
  let service: JobsService;

  const orsMock = { getRoute: jest.fn() };
  const prismaMock = {
    job: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };
  const userSettingsMock = {
    get: jest.fn(),
    getSigningDefaults: jest.fn(),
    getScanbackDuration: jest.fn(),
    getNotificationConfig: jest.fn(),
  };
  const geocodingMock = { geocode: jest.fn() };
  const redisMock = { del: jest.fn().mockResolvedValue(1) };
  const calendarSyncQueueMock = { add: jest.fn() };
  const notificationQueueMock = { add: jest.fn() };

  function createdJobData(): CreatedJobData {
    const call = prismaMock.job.create.mock.calls[0] as [
      args: { data: CreatedJobData },
    ];
    return call[0].data;
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: RedisService, useValue: redisMock },
        { provide: GeocodingService, useValue: geocodingMock },
        { provide: UserSettingsService, useValue: userSettingsMock },
        { provide: NotificationsService, useValue: {} },
        {
          provide: JournalService,
          useValue: { createForCompletedJob: jest.fn() },
        },
        { provide: OrsService, useValue: orsMock },
        {
          provide: InvoicesService,
          useValue: { generate: jest.fn(), syncDraftFromJob: jest.fn() },
        },
        {
          provide: getQueueToken(QUEUE_CALENDAR_SYNC),
          useValue: calendarSyncQueueMock,
        },
        {
          provide: getQueueToken(QUEUE_NOTIFICATION),
          useValue: notificationQueueMock,
        },
      ],
    }).compile();

    service = module.get<JobsService>(JobsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create mileage', () => {
    const baseDto: CreateJobDto = {
      address: '123 Main St, Atlanta, GA',
      appointment_time: '2026-08-05T14:00:00.000Z',
      fee: 150,
      signing_type: 'GENERAL',
      signing_duration_mins: 45,
      source: JobSource.MANUAL,
    };

    beforeEach(() => {
      userSettingsMock.get.mockResolvedValue({
        irs_rate_per_mile: '0.67',
        home_base_lat: 33.749,
        home_base_lng: -84.388,
      });
      geocodingMock.geocode.mockResolvedValue({ lat: 33.77, lng: -84.39 });
      prismaMock.job.create.mockResolvedValue({
        id: 'job-1',
        status: JobStatus.CONFIRMED,
      });
      calendarSyncQueueMock.add.mockResolvedValue({});
    });

    it('uses ORS driving distance and drive time when available', async () => {
      orsMock.getRoute.mockResolvedValue({
        distanceMiles: 12.34,
        driveTimeMins: 25,
      });

      await service.create('user-1', baseDto);

      expect(orsMock.getRoute).toHaveBeenCalledWith(
        33.749,
        -84.388,
        33.77,
        -84.39,
      );
      const data = createdJobData();
      expect(data.mileage_miles).toBe(12.34);
      expect(data.mileage_cost).toBeCloseTo(12.34 * 2 * 0.67, 2);
      // drive time (25 min) is included in effective-hourly denominator
      expect(data.effective_hourly).toBeGreaterThan(0);
    });

    it('falls back to straight-line distance when ORS is unavailable', async () => {
      orsMock.getRoute.mockResolvedValue(null);

      await service.create('user-1', baseDto);

      const data = createdJobData();
      expect(data.mileage_miles).toBeGreaterThan(0);
      expect(data.mileage_cost).toBeCloseTo(
        (data.mileage_miles as number) * 2 * 0.67,
        2,
      );
      expect(data.effective_hourly).toBeGreaterThan(0);
    });

    it('leaves mileage null when no home base is configured', async () => {
      userSettingsMock.get.mockResolvedValue({
        irs_rate_per_mile: '0.67',
        home_base_lat: null,
        home_base_lng: null,
      });

      await service.create('user-1', baseDto);

      const data = createdJobData();
      expect(data.mileage_miles).toBeNull();
      expect(data.mileage_cost).toBeNull();
    });
  });

  describe('update', () => {
    function updateData(): Record<string, unknown> {
      const call = prismaMock.job.update.mock.calls[0] as [
        args: { data: Record<string, unknown> },
      ];
      return call[0].data;
    }

    const confirmedLoanRefi = {
      id: 'job-1',
      user_id: 'user-1',
      address: '123 Main St, Atlanta, GA',
      appointment_time: new Date('2026-08-05T14:00:00.000Z'),
      signing_duration_mins: 30,
      scanback_duration_mins: 20,
      signing_type: 'LOAN_REFI',
      status: JobStatus.CONFIRMED,
      lat: 33.77,
      lng: -84.39,
      fee: 150,
      platform_fee: 0,
      source: JobSource.MANUAL,
    };

    beforeEach(() => {
      prismaMock.job.findFirst.mockResolvedValue(confirmedLoanRefi);
      prismaMock.job.update.mockImplementation(
        (args: { data: Record<string, unknown> }) =>
          ({
            id: 'job-1',
            status: confirmedLoanRefi.status,
            ...args.data,
          }) as Record<string, unknown>,
      );
      redisMock.del.mockClear();
    });

    it('re-anchors scanback_ends_at when only the appointment time changes', async () => {
      await service.update('user-1', 'job-1', {
        appointment_time: '2026-08-06T15:00:00.000Z',
      });

      const data = updateData();
      // signing window moves with the new time (15:00 + 30 min)
      expect(data.appointment_time).toEqual(
        new Date('2026-08-06T15:00:00.000Z'),
      );
      expect(data.signing_ends_at).toEqual(
        new Date('2026-08-06T15:30:00.000Z'),
      );
      // scanback block re-anchored (15:30 + 20 min)
      expect(data.scanback_ends_at).toEqual(
        new Date('2026-08-06T15:50:00.000Z'),
      );
      // unchanged duration must not be rewritten
      expect(data.scanback_duration_mins).toBeUndefined();
    });

    it('recomputes the scanback block when the signing duration changes', async () => {
      await service.update('user-1', 'job-1', {
        signing_duration_mins: 60,
      });

      const data = updateData();
      expect(data.signing_duration_mins).toBe(60);
      expect(data.signing_ends_at).toEqual(
        new Date('2026-08-05T15:00:00.000Z'),
      );
      expect(data.scanback_ends_at).toEqual(
        new Date('2026-08-05T15:20:00.000Z'),
      );
      expect(data.scanback_duration_mins).toBeUndefined();
    });

    it('does not clobber a live SCANNING countdown when rescheduling', async () => {
      prismaMock.job.findFirst.mockResolvedValue({
        ...confirmedLoanRefi,
        status: JobStatus.SCANNING,
      });

      await service.update('user-1', 'job-1', {
        appointment_time: '2026-08-06T15:00:00.000Z',
      });

      const data = updateData();
      expect(data.signing_ends_at).toBeDefined();
      expect(data.scanback_ends_at).toBeUndefined();
    });

    it('invalidates the route cache for the old and new dates on reschedule', async () => {
      await service.update('user-1', 'job-1', {
        appointment_time: '2026-08-06T15:00:00.000Z',
      });

      expect(redisMock.del).toHaveBeenCalledWith('route:user-1:2026-08-05');
      expect(redisMock.del).toHaveBeenCalledWith('route:user-1:2026-08-06');
    });
  });

  describe('dispatchClientEta', () => {
    const now = Date.now();

    const nextJob = (overrides: {
      appointment_time: Date;
      drive_from_prev_mins?: number | null;
    }) => ({
      id: 'job-next',
      client_email: 'client@example.com',
      client_name: 'Jane Client',
      address: '456 Oak Ave',
      signing_type: 'LOAN_REFI',
      ...overrides,
    });

    const eta = async (completedAt: Date) => {
      await (
        service as unknown as {
          dispatchClientEta: (
            userId: string,
            job: { appointment_time: Date },
          ) => Promise<void>;
        }
      ).dispatchClientEta('user-1', { appointment_time: completedAt });
    };

    beforeEach(() => {
      userSettingsMock.getNotificationConfig.mockResolvedValue({
        clientEtaEnabled: true,
      });
      prismaMock.job.findFirst.mockResolvedValue(null);
      notificationQueueMock.add.mockResolvedValue({});
    });

    it('enqueues the ETA when the next appointment is within the drive-time window', async () => {
      prismaMock.job.findFirst.mockResolvedValue(
        nextJob({
          appointment_time: new Date(now + 30 * 60_000),
          drive_from_prev_mins: 20,
        }),
      );

      await eta(new Date(now));

      expect(notificationQueueMock.add).toHaveBeenCalledWith(
        'send-client-eta',
        {
          userId: 'user-1',
          nextJobId: 'job-next',
          etaMins: 20,
        },
      );
    });

    it('uses the 20-minute fallback when drive_from_prev_mins is not set', async () => {
      prismaMock.job.findFirst.mockResolvedValue(
        nextJob({
          appointment_time: new Date(now + 30 * 60_000),
          drive_from_prev_mins: null,
        }),
      );

      await eta(new Date(now));

      expect(notificationQueueMock.add).toHaveBeenCalledWith(
        'send-client-eta',
        {
          userId: 'user-1',
          nextJobId: 'job-next',
          etaMins: 20,
        },
      );
    });

    it('does not send when the next appointment is a day away', async () => {
      prismaMock.job.findFirst.mockResolvedValue(
        nextJob({
          appointment_time: new Date(now + 24 * 60 * 60_000),
          drive_from_prev_mins: 20,
        }),
      );

      await eta(new Date(now));

      expect(notificationQueueMock.add).not.toHaveBeenCalled();
    });

    it('does not send when the appointment is already well past', async () => {
      prismaMock.job.findFirst.mockResolvedValue(
        nextJob({
          appointment_time: new Date(now - 60 * 60_000),
          drive_from_prev_mins: 20,
        }),
      );

      await eta(new Date(now));

      expect(notificationQueueMock.add).not.toHaveBeenCalled();
    });

    it('does nothing when the ETA preference is disabled', async () => {
      userSettingsMock.getNotificationConfig.mockResolvedValue({
        clientEtaEnabled: false,
      });
      prismaMock.job.findFirst.mockResolvedValue(
        nextJob({
          appointment_time: new Date(now + 30 * 60_000),
          drive_from_prev_mins: 20,
        }),
      );

      await eta(new Date(now));

      expect(prismaMock.job.findFirst).not.toHaveBeenCalled();
      expect(notificationQueueMock.add).not.toHaveBeenCalled();
    });

    it('does nothing when there is no next confirmed job', async () => {
      await eta(new Date(now));

      expect(notificationQueueMock.add).not.toHaveBeenCalled();
    });
  });
});
