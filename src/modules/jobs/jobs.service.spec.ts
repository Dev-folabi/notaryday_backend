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
  };
  const geocodingMock = { geocode: jest.fn() };
  const redisMock = { del: jest.fn().mockResolvedValue(1) };
  const calendarSyncQueueMock = { add: jest.fn() };

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
          provide: getQueueToken(QUEUE_CALENDAR_SYNC),
          useValue: calendarSyncQueueMock,
        },
        {
          provide: getQueueToken(QUEUE_NOTIFICATION),
          useValue: { add: jest.fn() },
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
});
