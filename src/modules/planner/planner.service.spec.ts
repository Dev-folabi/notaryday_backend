import { Test, TestingModule } from '@nestjs/testing';
import { PlannerService, PlannerJob } from './planner.service';
import { PrismaService } from '../../config/prisma.service';
import { RedisService } from '../../config/redis.service';
import { OrsService } from '../../common/services/ors.service';
import { UserSettingsService } from '../users/user-settings.service';
import { JobStatus, SigningType } from '../../../generated/prisma';

describe('PlannerService (gap finder)', () => {
  let service: PlannerService;

  const orsMock = {
    getRoute: jest.fn(),
    optimise: jest.fn(),
    fallbackTimeOrder: jest.fn(),
  };
  const prismaMock = {
    job: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    dayPlan: {
      upsert: jest.fn() as jest.Mock<
        Promise<Record<string, unknown>>,
        [unknown]
      >,
      findUnique: jest.fn() as jest.Mock<
        Promise<{ naive_total_drive_time: number | null } | null>,
        [unknown]
      >,
    },
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

  /** Raw prisma.job row shape used by optimise()/getToday(). */
  function rawJob(
    id: string,
    opts: { startH: number; startM: number; scanback?: number; drive?: number },
  ) {
    const duration = 45;
    return {
      id,
      address: `${id} address`,
      lat: 33.74,
      lng: -84.39,
      appointment_time: at(opts.startH, opts.startM),
      signing_duration_mins: duration,
      scanback_duration_mins: opts.scanback ?? 0,
      signing_type: SigningType.GENERAL,
      fee: 125,
      platform_fee: 0,
      net_earnings: 110,
      status: JobStatus.CONFIRMED,
      client_name: null,
      route_sequence: null,
      drive_from_prev_mins: opts.drive ?? null,
      drive_from_prev_miles: null,
      signing_ends_at: at(opts.startH, opts.startM + duration),
      scanback_ends_at: null,
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
      naive_total_drive_mins: null,
      saved_drive_mins: null,
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

    it('only considers pending jobs on the queried date', async () => {
      jest.spyOn(service, 'getToday').mockResolvedValue(dayPlan);
      prismaMock.job.findMany.mockResolvedValue([pendingJob('pending-1')]);
      orsMock.getRoute.mockResolvedValue({
        distanceMiles: 2,
        driveTimeMins: 6,
      });

      await service.findGaps('user-1', today);

      const [firstCall] = (
        prismaMock.job.findMany.mock.calls as Array<
          [{ where: { appointment_time: { gte: Date; lt: Date } } }]
        >
      )[0];
      const where = firstCall.where;
      expect(where.appointment_time.gte.toISOString()).toBe(
        '2026-08-05T00:00:00.000Z',
      );
      expect(where.appointment_time.lt.toISOString()).toBe(
        '2026-08-06T00:00:00.000Z',
      );
    });
  });

  describe('optimise', () => {
    type UpdateArgs = {
      where: { id: string };
      data: { route_sequence: number | null };
    };
    const updateCalls = () =>
      prismaMock.job.update.mock.calls as UpdateArgs[][];

    const seqFor = (jobId: string): number | null | undefined => {
      const call = updateCalls().find((c) => c[0].where.id === jobId);
      return call ? call[0].data.route_sequence : undefined;
    };

    beforeEach(() => {
      userSettingsMock.get.mockResolvedValue({
        irs_rate_per_mile: 0.72,
        home_base_lat: 33.7,
        home_base_lng: -84.4,
      });
      prismaMock.job.update.mockResolvedValue({});
      prismaMock.dayPlan.upsert.mockResolvedValue({});
      prismaMock.dayPlan.findUnique.mockResolvedValue(null);
    });

    it('falls back to time order when the ORS order is infeasible', async () => {
      const jobA = rawJob('job-a', { startH: 9, startM: 0 });
      const jobB = rawJob('job-b', { startH: 13, startM: 0 });
      prismaMock.job.findMany.mockResolvedValue([jobA, jobB]);

      // job-b (13:00) first, then job-a (09:00) 240 min later -> cannot be
      // reached within job-a's window, so the order must be rejected.
      orsMock.optimise.mockResolvedValue([
        {
          jobId: 'job-b',
          sequence: 1,
          driveFromPrevMins: 10,
          driveFromPrevMiles: 3,
        },
        {
          jobId: 'job-a',
          sequence: 2,
          driveFromPrevMins: 240,
          driveFromPrevMiles: 40,
        },
      ]);
      orsMock.fallbackTimeOrder.mockResolvedValue([
        {
          jobId: 'job-a',
          sequence: 1,
          driveFromPrevMins: 12,
          driveFromPrevMiles: 5,
        },
        {
          jobId: 'job-b',
          sequence: 2,
          driveFromPrevMins: 16,
          driveFromPrevMiles: 7,
        },
      ]);

      await service.optimise('user-1', '2026-08-05');

      expect(orsMock.fallbackTimeOrder).toHaveBeenCalled();
      expect(seqFor('job-a')).toBe(1);
      expect(seqFor('job-b')).toBe(2);
    });

    it('keeps a feasible ORS order', async () => {
      const jobA = rawJob('job-a', { startH: 9, startM: 0 });
      const jobB = rawJob('job-b', { startH: 13, startM: 0 });
      prismaMock.job.findMany.mockResolvedValue([jobA, jobB]);

      // 09:45 end + 15 min drive -> 10:00 arrival, inside job-b's window.
      orsMock.optimise.mockResolvedValue([
        {
          jobId: 'job-a',
          sequence: 1,
          driveFromPrevMins: 10,
          driveFromPrevMiles: 3,
        },
        {
          jobId: 'job-b',
          sequence: 2,
          driveFromPrevMins: 15,
          driveFromPrevMiles: 6,
        },
      ]);

      await service.optimise('user-1', '2026-08-05');

      expect(orsMock.fallbackTimeOrder).not.toHaveBeenCalled();
      expect(seqFor('job-a')).toBe(1);
      expect(seqFor('job-b')).toBe(2);
      // Optimised order == time order → naive total mirrors the route total.
      const upsertArgs = prismaMock.dayPlan.upsert.mock.calls[0][0] as {
        create: { naive_total_drive_time: number };
        update: { naive_total_drive_time: number };
      };
      expect(upsertArgs.create.naive_total_drive_time).toBe(25);
      expect(upsertArgs.update.naive_total_drive_time).toBe(25);
    });

    it('accounts for scanback when judging feasibility', async () => {
      const jobA = rawJob('job-a', { startH: 9, startM: 0, scanback: 30 });
      const jobB = rawJob('job-b', { startH: 13, startM: 0 });
      prismaMock.job.findMany.mockResolvedValue([jobA, jobB]);

      // 09:45 signing end + 30 min scanback + 240 min drive -> 14:15 arrival,
      // far past job-b's 13:00 window.
      orsMock.optimise.mockResolvedValue([
        {
          jobId: 'job-a',
          sequence: 1,
          driveFromPrevMins: 10,
          driveFromPrevMiles: 3,
        },
        {
          jobId: 'job-b',
          sequence: 2,
          driveFromPrevMins: 240,
          driveFromPrevMiles: 40,
        },
      ]);
      orsMock.fallbackTimeOrder.mockResolvedValue([
        {
          jobId: 'job-a',
          sequence: 1,
          driveFromPrevMins: 12,
          driveFromPrevMiles: 5,
        },
        {
          jobId: 'job-b',
          sequence: 2,
          driveFromPrevMins: 16,
          driveFromPrevMiles: 7,
        },
      ]);

      await service.optimise('user-1', '2026-08-05');

      expect(orsMock.fallbackTimeOrder).toHaveBeenCalled();
    });
  });

  describe('getToday', () => {
    it('reports saved drive minutes from the persisted DayPlan', async () => {
      const jobA = rawJob('job-a', { startH: 9, startM: 0, drive: 12 });
      const jobB = rawJob('job-b', { startH: 13, startM: 0, drive: 15 });
      prismaMock.job.findMany.mockResolvedValue([jobA, jobB]);
      prismaMock.dayPlan.findUnique.mockResolvedValue({
        naive_total_drive_time: 40,
      });

      const result = await service.getToday('user-1', '2026-08-05');

      expect(result.summary.total_drive_mins).toBe(27);
      expect(result.summary.naive_total_drive_mins).toBe(40);
      expect(result.summary.saved_drive_mins).toBe(13);
    });

    it('leaves saved drive minutes null when the route was never optimised', async () => {
      const jobA = rawJob('job-a', { startH: 9, startM: 0, drive: 12 });
      prismaMock.job.findMany.mockResolvedValue([jobA]);
      prismaMock.dayPlan.findUnique.mockResolvedValue(null);

      const result = await service.getToday('user-1', '2026-08-05');

      expect(result.summary.saved_drive_mins).toBeNull();
      expect(result.summary.naive_total_drive_mins).toBeNull();
    });
  });
});
