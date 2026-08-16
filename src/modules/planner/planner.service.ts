import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { RedisService } from '../../config/redis.service';
import {
  OrsService,
  OptimiseJob,
  OptimisedLeg,
} from '../../common/services/ors.service';
import { UserSettingsService } from '../users/user-settings.service';
// import { calculateProfitability } from '../../common/utils/profitability.util';
import { JobStatus, SigningType, Job } from '../../../generated/prisma';

// const ROUTE_CACHE_TTL = 3600;
// const SCANBACK_TYPES = new Set<SigningType>([
//   SigningType.LOAN_REFI,
//   SigningType.HYBRID,
//   SigningType.PURCHASE_CLOSING,
// ]);

export interface PlannerJob {
  id: string;
  address: string;
  lat: number;
  lng: number;
  appointment_time: Date;
  signing_duration_mins: number;
  scanback_duration_mins: number;
  signing_type: SigningType;
  fee: number;
  platform_fee: number;
  net_earnings: number;
  status: JobStatus;
  client_name: string | null;
  route_sequence: number | null;
  drive_from_prev_mins: number | null;
  drive_from_prev_miles: number | null;
  signing_ends_at: Date | null;
  scanback_ends_at: Date | null;
}

export interface ScanbackBlock {
  jobId: string;
  startsAt: Date;
  endsAt: Date;
  durationMins: number;
}

export interface Conflict {
  fromJobId: string;
  toJobId: string;
  shortfallMins: number;
  message: string;
}

export interface TodayPlanResult {
  jobs: PlannerJob[];
  scanback_blocks: ScanbackBlock[];
  summary: {
    total_jobs: number;
    total_drive_mins: number;
    total_earnings: number;
    total_miles: number;
    naive_total_drive_mins: number | null;
    saved_drive_mins: number | null;
  };
  optimised: boolean;
  conflicts: Conflict[];
}

export interface GapCandidate {
  gap_start: Date;
  gap_end: Date;
  gap_mins: number;
  prev_job_id: string;
  next_job_id: string;
  prev_job_label: string;
  next_job_label: string;
  candidates: GapCandidateJob[];
}

export interface GapCandidateJob {
  id: string;
  address: string;
  fee: number;
  net_earnings: number;
  signing_type: SigningType;
  signing_duration_mins: number;
  scanback_duration_mins: number;
  platform_name: string | null;
  client_name: string | null;
  appointment_time: Date;
  miles_from: number | null;
  miles_from_label: string | null;
}

@Injectable()
export class PlannerService {
  private readonly logger = new Logger(PlannerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly ors: OrsService,
    private readonly userSettings: UserSettingsService,
  ) {}

  // GET /planner/today
  async getToday(userId: string, date: string): Promise<TodayPlanResult> {
    const day = new Date(date);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);

    const jobs = await this.prisma.job.findMany({
      where: {
        user_id: userId,
        deleted_at: null,
        status: {
          in: [JobStatus.CONFIRMED, JobStatus.IN_PROGRESS, JobStatus.SCANNING],
        },
        appointment_time: { gte: day, lt: next },
      },
      orderBy: [{ route_sequence: 'asc' }, { appointment_time: 'asc' }],
    });

    const optimised = jobs.length > 0 && jobs[0].route_sequence != null;

    const plannerJobs: PlannerJob[] = jobs.map((j) => ({
      id: j.id,
      address: j.address,
      lat: Number(j.lat),
      lng: Number(j.lng),
      appointment_time: j.appointment_time,
      signing_duration_mins: j.signing_duration_mins,
      scanback_duration_mins: j.scanback_duration_mins,
      signing_type: j.signing_type,
      fee: Number(j.fee),
      platform_fee: Number(j.platform_fee),
      net_earnings: Number(j.net_earnings),
      status: j.status,
      client_name: j.client_name,
      route_sequence: j.route_sequence,
      drive_from_prev_mins: j.drive_from_prev_mins,
      drive_from_prev_miles: j.drive_from_prev_miles
        ? Number(j.drive_from_prev_miles)
        : null,
      signing_ends_at: j.signing_ends_at,
      scanback_ends_at: j.scanback_ends_at,
    }));

    // Lazily compute + persist any missing drive legs in schedule order, so the
    // day always carries real drive times without requiring POST /planner/optimise.
    await this.populateDriveTimes(userId, plannerJobs);

    // Build scanback blocks
    const scanback_blocks: ScanbackBlock[] = plannerJobs
      .filter((j) => j.scanback_duration_mins > 0 && j.signing_ends_at)
      .map((j) => ({
        jobId: j.id,
        startsAt: j.signing_ends_at!,
        endsAt:
          j.scanback_ends_at ??
          new Date(
            j.signing_ends_at!.getTime() + j.scanback_duration_mins * 60_000,
          ),
        durationMins: j.scanback_duration_mins,
      }));

    // Detect conflicts
    const conflicts: Conflict[] = [];
    for (let i = 0; i < plannerJobs.length - 1; i++) {
      const curr = plannerJobs[i];
      const nextJob = plannerJobs[i + 1];
      const currEnds = curr.scanback_ends_at ?? curr.signing_ends_at;
      if (!currEnds) continue;

      const driveToNext = nextJob.drive_from_prev_mins ?? 0;
      const availableGap =
        (nextJob.appointment_time.getTime() - currEnds.getTime()) / 60_000;
      if (availableGap < driveToNext) {
        conflicts.push({
          fromJobId: curr.id,
          toJobId: nextJob.id,
          shortfallMins: Math.ceil(driveToNext - availableGap),
          message: `${Math.ceil(driveToNext - availableGap)} min short to reach next job`,
        });
      }
    }

    const summary = {
      total_jobs: plannerJobs.length,
      total_drive_mins: plannerJobs.reduce(
        (s, j) => s + (j.drive_from_prev_mins ?? 0),
        0,
      ),
      total_earnings: plannerJobs.reduce((s, j) => s + j.net_earnings, 0),
      total_miles: plannerJobs.reduce(
        (s, j) => s + (j.drive_from_prev_miles ?? 0),
        0,
      ),
      naive_total_drive_mins: null as number | null,
      saved_drive_mins: null as number | null,
    };

    // Time-entry-order drive total is only meaningful once the route has been
    // optimised; it's persisted on the DayPlan by POST /planner/optimise.
    if (summary.total_drive_mins > 0) {
      try {
        const dayPlan = await this.prisma.dayPlan.findUnique({
          where: { user_id_date: { user_id: userId, date: day } },
          select: { naive_total_drive_time: true },
        });
        const naiveTotal = dayPlan?.naive_total_drive_time ?? null;
        if (naiveTotal != null) {
          summary.naive_total_drive_mins = naiveTotal;
          summary.saved_drive_mins = Math.max(
            0,
            naiveTotal - summary.total_drive_mins,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Failed to read DayPlan naive drive time for ${date}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return {
      jobs: plannerJobs,
      scanback_blocks,
      summary,
      optimised,
      conflicts,
    };
  }

  // Lazily compute + persist drive legs for any jobs missing them, walking the
  // day in appointment order (home base → first job → next job → ...).
  private async populateDriveTimes(
    userId: string,
    jobs: PlannerJob[],
  ): Promise<void> {
    const missing = jobs.filter((j) => j.drive_from_prev_mins == null);
    if (missing.length === 0) return;

    const settings = await this.userSettings.get(userId);
    let originLat = Number(settings.home_base_lat);
    let originLng = Number(settings.home_base_lng);

    const sorted = [...jobs].sort(
      (a, b) => a.appointment_time.getTime() - b.appointment_time.getTime(),
    );

    for (const job of sorted) {
      if (job.drive_from_prev_mins != null) {
        originLat = job.lat;
        originLng = job.lng;
        continue;
      }

      let driveMins = 0;
      let driveMiles = 0;
      let computed = false;
      if (originLat && originLng) {
        const route = await this.ors.getRoute(
          originLat,
          originLng,
          job.lat,
          job.lng,
        );
        if (route) {
          driveMins = route.driveTimeMins;
          driveMiles = route.distanceMiles;
          computed = true;
        }
      }
      // No home base or ORS unavailable → leave null so we retry next call
      // instead of persisting a fake 0 that would never recompute.
      if (!computed) continue;

      try {
        await this.prisma.job.update({
          where: { id: job.id },
          data: {
            drive_from_prev_mins: driveMins,
            drive_from_prev_miles: driveMiles,
          },
        });
      } catch (err) {
        this.logger.warn(
          `Failed to persist drive time for job ${job.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      job.drive_from_prev_mins = driveMins;
      job.drive_from_prev_miles = driveMiles;
      originLat = job.lat;
      originLng = job.lng;
    }
  }

  // POST /planner/optimise
  async optimise(userId: string, date: string): Promise<TodayPlanResult> {
    const settings = await this.userSettings.get(userId);
    const homeLat = Number(settings.home_base_lat);
    const homeLng = Number(settings.home_base_lng);

    if (!homeLat || !homeLng) {
      return this.getToday(userId, date);
    }

    const day = new Date(date);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);

    const jobs = await this.prisma.job.findMany({
      where: {
        user_id: userId,
        deleted_at: null,
        status: {
          in: [JobStatus.CONFIRMED, JobStatus.IN_PROGRESS, JobStatus.SCANNING],
        },
        appointment_time: { gte: day, lt: next },
      },
      orderBy: { appointment_time: 'asc' },
    });

    if (jobs.length === 0) return this.getToday(userId, date);

    // Build ORS jobs
    const orsJobs: OptimiseJob[] = jobs.map((j) => ({
      id: j.id,
      lat: Number(j.lat),
      lng: Number(j.lng),
      appointmentTime: j.appointment_time,
      signingDurationMins: j.signing_duration_mins ?? 0,
      scanbackDurationMins: j.scanback_duration_mins ?? 0,
    }));

    const legs = await this.ors.optimise(homeLat, homeLng, orsJobs);

    // Guard against an optimised order that can't actually be reached on time.
    // The solver optimises for drive time; if it returns a sequence where a
    // job's appointment can't be met given the previous leg's drive + service
    // time, fall back to plain time order so the day stays feasible.
    if (!this.isFeasibleOrder(jobs, legs)) {
      this.logger.warn(
        'ORS optimised order violates appointment feasibility, using time order',
      );
      const fallback = await this.ors.fallbackTimeOrder(
        homeLat,
        homeLng,
        orsJobs,
      );
      return this.applyRoute(
        userId,
        day,
        date,
        jobs,
        fallback,
        homeLat,
        homeLng,
      );
    }

    return this.applyRoute(userId, day, date, jobs, legs, homeLat, homeLng);
  }

  /**
   * True when every leg in the sequence is reachable before its appointment:
   * previous job end (appointment + signing + scanback) + drive time must not
   * overshoot the next job's appointment window (+10 min tolerance).
   */
  private isFeasibleOrder(jobs: Job[], legs: OptimisedLeg[]): boolean {
    if (legs.length < 2) return true;

    const byId = new Map(jobs.map((j) => [j.id, j]));

    for (let i = 1; i < legs.length; i++) {
      const prevLeg = legs[i - 1];
      const leg = legs[i];

      const prevJob = byId.get(prevLeg.jobId);
      const job = byId.get(leg.jobId);
      if (!prevJob || !job) continue;

      const prevServiceMins =
        (prevJob.signing_duration_mins ?? 0) +
        (prevJob.scanback_duration_mins ?? 0);
      const prevEnds = new Date(
        prevJob.appointment_time.getTime() + prevServiceMins * 60_000,
      );
      // Each leg's drive time is measured from the previous stop to this job.
      const driveMins = leg.driveFromPrevMins ?? 0;
      const arrival = new Date(prevEnds.getTime() + driveMins * 60_000);

      // Appointments are anchored to ±10 min; allow the same tolerance.
      const appointment = job.appointment_time.getTime();
      if (arrival.getTime() > appointment + 10 * 60_000) {
        return false;
      }
    }
    return true;
  }

  /** Persist a route (legs) onto jobs, update DayPlan, invalidate the cache. */
  private async applyRoute(
    userId: string,
    day: Date,
    date: string,
    jobs: Job[],
    legs: OptimisedLeg[],
    homeLat: number,
    homeLng: number,
  ): Promise<TodayPlanResult> {
    // Update jobs with route data
    for (const leg of legs) {
      const job = jobs.find((j) => j.id === leg.jobId);
      if (!job) continue;

      const scanbackEndsAt = job.signing_ends_at
        ? new Date(
            job.signing_ends_at.getTime() + job.scanback_duration_mins * 60_000,
          )
        : null;

      await this.prisma.job.update({
        where: { id: leg.jobId },
        data: {
          route_sequence: leg.sequence,
          drive_from_prev_mins: leg.driveFromPrevMins,
          drive_from_prev_miles: leg.driveFromPrevMiles,
          scanback_ends_at: scanbackEndsAt,
        },
      });
    }

    // Upsert DayPlan
    const totalDrive = legs.reduce((s, l) => s + l.driveFromPrevMins, 0);
    const totalEarnings = jobs.reduce((s, j) => s + Number(j.net_earnings), 0);

    // Naive (time-entry order) drive total — powers the "saved X min" figure.
    // Only worth computing when the optimised order actually differs.
    const timeOrderIds = [...jobs]
      .sort(
        (a, b) => a.appointment_time.getTime() - b.appointment_time.getTime(),
      )
      .map((j) => j.id);
    const optimisedIds = legs.map((l) => l.jobId);
    let naiveTotal = totalDrive;
    if (optimisedIds.join('|') !== timeOrderIds.join('|')) {
      const naiveLegs = await this.ors.fallbackTimeOrder(
        homeLat,
        homeLng,
        jobs.map((j) => ({
          id: j.id,
          lat: Number(j.lat),
          lng: Number(j.lng),
          appointmentTime: j.appointment_time,
          signingDurationMins: j.signing_duration_mins ?? 0,
          scanbackDurationMins: j.scanback_duration_mins ?? 0,
        })),
      );
      naiveTotal = naiveLegs.reduce((s, l) => s + l.driveFromPrevMins, 0);
    }

    await this.prisma.dayPlan.upsert({
      where: { user_id_date: { user_id: userId, date: day } },
      create: {
        user_id: userId,
        date: day,
        total_drive_time: totalDrive,
        naive_total_drive_time: naiveTotal,
        total_earnings: totalEarnings,
      },
      update: {
        total_drive_time: totalDrive,
        naive_total_drive_time: naiveTotal,
        total_earnings: totalEarnings,
      },
    });

    // Cache invalidation + refresh
    await this.invalidateRouteCache(userId, date);

    return this.getToday(userId, date);
  }

  // GET /planner/gaps
  async findGaps(userId: string, date: string): Promise<GapCandidate[]> {
    const plan = await this.getToday(userId, date);
    if (plan.jobs.length < 2) return [];

    const settings = await this.userSettings.get(userId);
    const irsRate = Number(settings.irs_rate_per_mile ?? 0.72);

    // Get pending jobs for this user, scoped to the queried day so a gap only
    // surfaces candidates the notary could actually do today.
    const day = new Date(date);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    const pendingJobs = await this.prisma.job.findMany({
      where: {
        user_id: userId,
        deleted_at: null,
        status: JobStatus.PENDING,
        appointment_time: { gte: day, lt: next },
      },
      orderBy: { fee: 'desc' },
      take: 50,
    });

    if (pendingJobs.length === 0) return [];

    const gaps: GapCandidate[] = [];
    const BUFFER = 10; // minutes of breathing room around the slot
    const DRIVE_BUFFER = 20; // fallback drive minutes when routing is unavailable

    for (let i = 0; i < plan.jobs.length - 1; i++) {
      const curr = plan.jobs[i];
      const nextJob = plan.jobs[i + 1];

      const currEnds =
        curr.scanback_ends_at ?? curr.signing_ends_at ?? curr.appointment_time;
      const gapStartMs = currEnds.getTime() + BUFFER * 60_000;
      const driveToNext = nextJob.drive_from_prev_mins ?? DRIVE_BUFFER;
      const gapEndMs =
        nextJob.appointment_time.getTime() - (driveToNext + BUFFER) * 60_000;
      const gapMins = (gapEndMs - gapStartMs) / 60_000;

      if (gapMins < 30) continue; // too short

      // Origin for the gap leg is where the notary is when the gap starts:
      // the end of the preceding job.
      const fromLat = curr.lat ? Number(curr.lat) : null;
      const fromLng = curr.lng ? Number(curr.lng) : null;
      const prevLabel = `Job ${i + 1}`;
      const nextLabel = `Job ${i + 2}`;

      // Find pending jobs that could fit the window, measuring real drive
      // time/distance from the preceding job and re-estimating net earnings
      // for the extra miles.
      const matched: GapCandidateJob[] = [];
      for (const p of pendingJobs) {
        const signingMins = p.signing_duration_mins ?? 45;
        const scanbackMins = p.scanback_duration_mins ?? 0;
        const pLat = p.lat != null ? Number(p.lat) : null;
        const pLng = p.lng != null ? Number(p.lng) : null;

        let driveMins = DRIVE_BUFFER;
        let milesFrom: number | null = null;
        let milesFromLabel: string | null = null;
        if (
          fromLat != null &&
          fromLng != null &&
          pLat != null &&
          pLng != null
        ) {
          const route = await this.ors.getRoute(fromLat, fromLng, pLat, pLng);
          if (route) {
            driveMins = route.driveTimeMins;
            milesFrom = route.distanceMiles;
            milesFromLabel = prevLabel;
          }
        }

        const totalNeeded = driveMins + signingMins + scanbackMins + BUFFER;
        if (totalNeeded > gapMins) continue;

        const fee = Number(p.fee ?? 0);
        const platformFee = Number(p.platform_fee ?? 0);
        const netEarnings =
          milesFrom != null
            ? Math.round((fee - milesFrom * 2 * irsRate - platformFee) * 100) /
              100
            : Number(p.net_earnings ?? fee);

        matched.push({
          id: p.id,
          address: p.address,
          fee,
          net_earnings: netEarnings,
          signing_type: p.signing_type,
          signing_duration_mins: signingMins,
          scanback_duration_mins: scanbackMins,
          platform_name: p.platform_name,
          client_name: p.client_name,
          appointment_time: p.appointment_time,
          miles_from: milesFrom,
          miles_from_label: milesFromLabel,
        });
      }

      // Best fit first: highest estimated net after gap-leg mileage
      matched.sort((a, b) => b.net_earnings - a.net_earnings);

      if (matched.length > 0) {
        gaps.push({
          gap_start: new Date(gapStartMs),
          gap_end: new Date(gapEndMs),
          gap_mins: Math.floor(gapMins),
          prev_job_id: curr.id,
          next_job_id: nextJob.id,
          prev_job_label: prevLabel,
          next_job_label: nextLabel,
          candidates: matched.slice(0, 3),
        });
      }
    }

    return gaps;
  }

  // Cache invalidation
  async invalidateRouteCache(userId: string, date: string): Promise<void> {
    try {
      await this.redis.del(`route:${userId}:${date}`);
    } catch (err) {
      this.logger.warn(
        `Route cache invalidation skipped for ${date}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
