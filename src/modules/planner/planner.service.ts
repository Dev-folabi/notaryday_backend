import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { RedisService } from '../../config/redis.service';
import {
  OrsService,
  OptimiseJob,
  OptimisedLeg,
} from '../../common/services/ors.service';
import { UserSettingsService } from '../users/user-settings.service';
import { calculateProfitability } from '../../common/utils/profitability.util';
import { JobStatus, SigningType } from '../../../generated/prisma';

const ROUTE_CACHE_TTL = 3600;
const SCANBACK_TYPES = new Set<SigningType>([
  SigningType.LOAN_REFI,
  SigningType.HYBRID,
  SigningType.PURCHASE_CLOSING,
]);

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
  };
  optimised: boolean;
  conflicts: Conflict[];
}

export interface GapCandidate {
  gap_start: Date;
  gap_end: Date;
  gap_mins: number;
  candidates: Array<{
    id: string;
    address: string;
    fee: number;
    net_earnings: number;
    signing_type: SigningType;
    appointment_time: Date;
  }>;
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
    };

    return {
      jobs: plannerJobs,
      scanback_blocks,
      summary,
      optimised,
      conflicts,
    };
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
    }));

    const legs = await this.ors.optimise(homeLat, homeLng, orsJobs);

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

    await this.prisma.dayPlan.upsert({
      where: { user_id_date: { user_id: userId, date: day } },
      create: {
        user_id: userId,
        date: day,
        total_drive_time: totalDrive,
        total_earnings: totalEarnings,
      },
      update: { total_drive_time: totalDrive, total_earnings: totalEarnings },
    });

    // Cache invalidation + refresh
    await this.invalidateRouteCache(userId, date);

    return this.getToday(userId, date);
  }

  // GET /planner/gaps
  async findGaps(userId: string, date: string): Promise<GapCandidate[]> {
    const plan = await this.getToday(userId, date);
    if (plan.jobs.length < 1) return [];

    // Get pending jobs for this user (any date)
    const pendingJobs = await this.prisma.job.findMany({
      where: { user_id: userId, deleted_at: null, status: JobStatus.PENDING },
      orderBy: { fee: 'desc' },
      take: 20,
    });

    if (pendingJobs.length === 0) return [];

    const gaps: GapCandidate[] = [];
    const BUFFER = 10; // minutes

    for (let i = 0; i < plan.jobs.length - 1; i++) {
      const curr = plan.jobs[i];
      const nextJob = plan.jobs[i + 1];

      const currEnds =
        curr.scanback_ends_at ?? curr.signing_ends_at ?? curr.appointment_time;
      const gapStartMs = currEnds.getTime() + BUFFER * 60_000;
      const driveToNext = nextJob.drive_from_prev_mins ?? 15;
      const gapEndMs =
        nextJob.appointment_time.getTime() - (driveToNext + BUFFER) * 60_000;
      const gapMins = (gapEndMs - gapStartMs) / 60_000;

      if (gapMins < 30) continue; // too short

      // Find pending jobs that could fit
      const candidates = pendingJobs
        .filter((p) => {
          const totalNeeded =
            (p.signing_duration_mins ?? 45) +
            (p.scanback_duration_mins ?? 0) +
            20; // +20 for drive buffer
          return totalNeeded <= gapMins;
        })
        .slice(0, 3)
        .map((p) => ({
          id: p.id,
          address: p.address,
          fee: Number(p.fee),
          net_earnings: Number(p.net_earnings),
          signing_type: p.signing_type,
          appointment_time: p.appointment_time,
        }));

      if (candidates.length > 0) {
        gaps.push({
          gap_start: new Date(gapStartMs),
          gap_end: new Date(gapEndMs),
          gap_mins: Math.floor(gapMins),
          candidates,
        });
      }
    }

    return gaps;
  }

  // Cache invalidation
  async invalidateRouteCache(userId: string, date: string): Promise<void> {
    await this.redis.del(`route:${userId}:${date}`);
  }
}
