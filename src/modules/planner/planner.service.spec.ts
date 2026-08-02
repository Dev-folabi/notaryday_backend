import { Test, TestingModule } from '@nestjs/testing';
import { PlannerService, PlannerJob } from './planner.service';
import { PrismaService } from '../../config/prisma.service';
import { RedisService } from '../../config/redis.service';
import { OrsService } from '../../common/services/ors.service';
import { UserSettingsService } from '../users/user-settings.service';
import { JobStatus, SigningType } from '../../../generated/prisma';

describe('PlannerService (gap finder)', () => {
  let service: PlannerService;

  const orsMock = { getRoute: jest.fn(), optimise: jest.fn() };
  const prismaMock = {
    job: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    dayPlan: { upsert: jest.fn() },
  };
  const redisMock = {
    del: jest.fn().mockResolvedValue(1),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
  };
  const userSettingsMock = { get: jest.fn(), update: jest.fn() };

  const at = (h: number, m = 0): Date =>
    new Date(
      `2026-08-05T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`,
    );

  function plannerJob(
    id: string,
    opts: { startH: number; startM: number; endH: number; endM: number },
  ): PlannerJob {
    return {
      id,
      address: `${id} address`,
      lat: 33.74,
      lng: -84.39,
      appointment_time: at(opts.startH, opts.startM),
      signing_duration_mins: 45,
      scanback_duration_mins: 0,
      signing_type: SigningType.GENERAL,
      fee: 125,
      platform_fee: 0,
      net_earnings: 110,
      status: JobStatus.CONFIRMED,
      client_name: null,
      route_sequence: 1,
      drive_from_prev_mins: 15,
      drive_from_prev_miles: 6.2,
      signing_ends_at: at(opts.endH, opts.endM),
      scanback_ends_at: null,
    };
  }

  function pendingJob(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      address: `${id} address`,
      lat: 33.75,
      lng: -84.38,
      appointment_time: at(12),
      signing_duration_mins: 45,
      scanback_duration_mins: 0,
      signing_type: SigningType.LOAN_REFI,
      fee: 150,
      platform_fee: 0,
      net_earnings: 130,
      status: JobStatus.PENDING,
      client_name: null,
      platform_name: 'Snapdocs',
      ...overrides,
    };
  }

  const plan = (jobs: PlannerJob[]) => ({
    jobs,
    scanback_blocks: [],
    summary: {
      total_jobs: jobs.length,
      total_drive_mins: 0,
      total_earnings: 0,
      total_miles: 0,
    },
    optimised: false,
    conflicts: [],
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlannerService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: RedisService, useValue: redisMock },
        { provide: OrsService, useValue: orsMock },
        { provide: UserSettingsService, useValue: userSettingsMock },
      ],
    }).compile();

    service = module.get<PlannerService>(PlannerService);

    userSettingsMock.get.mockResolvedValue({ irs_rate_per_mile: 0.72 });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findGaps', () => {
    // Job A ends 09:45 (no scanback) → gap starts 09:55.
    // Job B starts 13:00, drive_from_prev 15 min → gap ends 12:35.
    // Window = 160 min.
    const today = '2026-08-05';
    const dayPlan = plan([
      plannerJob('job-a', { startH: 9, startM: 0, endH: 9, endM: 45 }),
      plannerJob('job-b', { startH: 13, startM: 0, endH: 13, endM: 45 }),
    ]);

    it('returns [] when there are fewer than 2 confirmed jobs', async () => {
      jest
        .spyOn(service, 'getToday')
        .mockResolvedValue(
          plan([
            plannerJob('only', { startH: 9, startM: 0, endH: 9, endM: 45 }),
          ]),
        );

      await expect(service.findGaps('user-1', today)).resolves.toEqual([]);
      expect(prismaMock.job.findMany).not.toHaveBeenCalled();
    });

    it('returns [] when there are no pending jobs', async () => {
      jest.spyOn(service, 'getToday').mockResolvedValue(dayPlan);
      prismaMock.job.findMany.mockResolvedValue([]);

      await expect(service.findGaps('user-1', today)).resolves.toEqual([]);
    });

    it('skips a gap that is too short to be useful', async () => {
      // Gap between 09:45 and 10:10 is ~10 min after buffers → skipped.
      jest
        .spyOn(service, 'getToday')
        .mockResolvedValue(
          plan([
            plannerJob('job-a', { startH: 9, startM: 0, endH: 9, endM: 45 }),
            plannerJob('job-b', { startH: 10, startM: 10, endH: 10, endM: 55 }),
          ]),
        );
      prismaMock.job.findMany.mockResolvedValue([pendingJob('pending-1')]);
      orsMock.getRoute.mockResolvedValue({
        distanceMiles: 2,
        driveTimeMins: 8,
      });

      await expect(service.findGaps('user-1', today)).resolves.toEqual([]);
    });

    it('returns a gap with context labels and a ranked candidate', async () => {
      jest.spyOn(service, 'getToday').mockResolvedValue(dayPlan);
      prismaMock.job.findMany.mockResolvedValue([pendingJob('pending-1')]);
      orsMock.getRoute.mockResolvedValue({
        distanceMiles: 5,
        driveTimeMins: 10,
      });

      const gaps = await service.findGaps('user-1', today);

      expect(gaps).toHaveLength(1);
      const gap = gaps[0];
      expect(gap.prev_job_label).toBe('Job 1');
      expect(gap.next_job_label).toBe('Job 2');
      expect(gap.prev_job_id).toBe('job-a');
      expect(gap.next_job_id).toBe('job-b');
      expect(gap.gap_mins).toBe(160);
      expect(gap.candidates).toHaveLength(1);
      expect(gap.candidates[0].id).toBe('pending-1');
      expect(gap.candidates[0].miles_from).toBe(5);
      expect(gap.candidates[0].miles_from_label).toBe('Job 1');
      expect(gap.candidates[0].signing_duration_mins).toBe(45);
      expect(gap.candidates[0].platform_name).toBe('Snapdocs');
      // net = 150 - (5 * 2 * 0.72) - 0 = 142.80
      expect(gap.candidates[0].net_earnings).toBe(142.8);
    });

    it('ranks candidates by estimated net after gap-leg mileage', async () => {
      jest.spyOn(service, 'getToday').mockResolvedValue(dayPlan);
      prismaMock.job.findMany.mockResolvedValue([
        pendingJob('far', { fee: 200, platform_fee: 0 }),
        pendingJob('near', { fee: 150, platform_fee: 0 }),
      ]);
      // far: 20 mi drive → net = 200 - 28.8 = 171.2
      // near: 2 mi drive → net = 150 - 2.88 = 147.12
      orsMock.getRoute.mockImplementation(
        (fromLat: number, fromLng: number, toLat: number, toLng: number) => {
          const fromKey = `${fromLat},${fromLng}`;
          if (fromKey === '33.74,-84.39') {
            return { distanceMiles: 20, driveTimeMins: 25 };
          }
          void toLat;
          void toLng;
          return { distanceMiles: 2, driveTimeMins: 6 };
        },
      );

      const gaps = await service.findGaps('user-1', today);
      const ids = gaps[0].candidates.map((c) => c.id);

      expect(ids).toEqual(['far', 'near']);
      expect(gaps[0].candidates[0].net_earnings).toBe(171.2);
    });

    it('excludes a candidate whose real drive time overflows the window', async () => {
      jest.spyOn(service, 'getToday').mockResolvedValue(dayPlan);
      prismaMock.job.findMany.mockResolvedValue([
        pendingJob('pending-near', { lat: 33.75 }),
        pendingJob('pending-far', { lat: 34.5 }),
      ]);
      orsMock.getRoute.mockImplementation(
        (fromLat: number, fromLng: number, toLat: number, toLng: number) => {
          void fromLat;
          void fromLng;
          void toLng;
          return {
            distanceMiles: 60,
            // 200 min drive overflows: 200 + 45 + 10 = 255 > 160
            driveTimeMins: toLat === 34.5 ? 200 : 6,
          };
        },
      );

      const gaps = await service.findGaps('user-1', today);

      expect(gaps).toHaveLength(1);
      expect(gaps[0].candidates.map((c) => c.id)).toEqual(['pending-near']);
    });

    it('falls back to the drive buffer when ORS is unavailable', async () => {
      jest.spyOn(service, 'getToday').mockResolvedValue(dayPlan);
      prismaMock.job.findMany.mockResolvedValue([pendingJob('pending-1')]);
      orsMock.getRoute.mockResolvedValue(null);

      const gaps = await service.findGaps('user-1', today);

      expect(gaps).toHaveLength(1);
      const candidate = gaps[0].candidates[0];
      expect(candidate.miles_from).toBeNull();
      expect(candidate.miles_from_label).toBeNull();
      // no route → keep the stored net estimate
      expect(candidate.net_earnings).toBe(130);
    });

    it('caps candidates at 3 per gap', async () => {
      jest.spyOn(service, 'getToday').mockResolvedValue(dayPlan);
      prismaMock.job.findMany.mockResolvedValue(
        [1, 2, 3, 4, 5].map((n) => pendingJob(`pending-${n}`)),
      );
      orsMock.getRoute.mockResolvedValue({
        distanceMiles: 2,
        driveTimeMins: 6,
      });

      const gaps = await service.findGaps('user-1', today);

      expect(gaps[0].candidates).toHaveLength(3);
    });
  });
});
