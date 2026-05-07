import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import crypto from 'crypto';
import axios from 'axios';
import { PrismaService } from '../../config/prisma.service';
import { RedisService } from '../../config/redis.service';
import { GeocodingService } from '../geocoding/geocoding.service';
import { UserSettingsService } from '../users/user-settings.service';
import { JobsService } from '../jobs/jobs.service';
import { calculateProfitability } from '../../common/utils/profitability.util';
import { CittCheckDto } from './dto/citt-check.dto';
import { JobStatus, SigningType } from '../../../generated/prisma';

/** CITT verdict thresholds */
const MIN_GAP_MINS = 10; // Gap below this = RISKY
const TAKE_IT_NET = 20; // Net ≥ $20 = TAKE IT
const RISKY_NET = 10; // Net $10–$19 = RISKY, below = DECLINE

/** ORS route cache TTL: 1 hour */
const ORS_CACHE_TTL = 3600;
/** CITT result cache TTL: 5 min */
const CITT_CACHE_TTL = 300;

export type CittVerdict = 'TAKE_IT' | 'RISKY' | 'DECLINE';

export interface CittResult {
  verdict: CittVerdict;
  reason: string;
  drive_distance_miles: number;
  drive_time_mins: number;
  mileage_cost: number;
  net_earnings: number;
  effective_hourly: number;
  total_job_mins: number;
  can_make_it: boolean;
  scanback_conflict: boolean;
  scanback_conflict_detail?: string;
  gap_before?: number | null;
  gap_after?: number | null;
  prev_job?: {
    type: SigningType;
    time: Date;
    duration: number;
  } | null;
  next_job?: {
    type: SigningType;
    time: Date;
  } | null;
}

@Injectable()
export class CittService {
  private readonly logger = new Logger(CittService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly geocoding: GeocodingService,
    private readonly userSettings: UserSettingsService,
    private readonly jobsService: JobsService,
    private readonly config: ConfigService,
  ) {}

  async runCheck(userId: string, dto: CittCheckDto): Promise<CittResult> {
    // Build a stable cache key by sorting keys
    const stableDto = Object.fromEntries(
      Object.entries(dto).sort(([a], [b]) => a.localeCompare(b)),
    );

    const cacheFingerprint = crypto
      .createHash('md5')
      .update(JSON.stringify(stableDto))
      .digest('hex');

    const cacheKey = `citt:${userId}:${cacheFingerprint}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.debug(`[CITT] Cache hit: ${cacheKey}`);
      return JSON.parse(cached) as CittResult;
    }

    // Fetch user settings
    const settings = await this.userSettings.get(userId);
    const irsRate = Number(settings.irs_rate_per_mile);
    const minAcceptableNet = Number(settings.min_acceptable_net) || RISKY_NET;

    // Geocode the proposed job address
    const jobGeo = await this.geocoding.geocode(dto.address);
    if (!jobGeo) {
      return this.decline(
        'Could not geocode address. Please verify the address and try again.',
        0,
        0,
        0,
        0,
      );
    }

    // Determine signing duration
    const signingType = dto.signing_type ?? SigningType.GENERAL;
    const signingDurationMins =
      dto.signing_duration_mins ??
      (await this.getSigningDuration(userId, signingType));
    const scanbackMins = await this.jobsService.getScanbackDuration(
      userId,
      signingType,
    );

    const appointmentTime = new Date(dto.appointment_time);
    const jobEndsAt = new Date(
      appointmentTime.getTime() + (signingDurationMins + scanbackMins) * 60_000,
    );

    // Find nearest confirmed/in-progress anchor jobs on same day
    const dayStart = new Date(appointmentTime);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const anchoredJobs = await this.prisma.job.findMany({
      where: {
        user_id: userId,
        deleted_at: null,
        status: { in: [JobStatus.CONFIRMED, JobStatus.IN_PROGRESS] },
        appointment_time: { gte: dayStart, lt: dayEnd },
      },
      orderBy: { appointment_time: 'asc' },
    });

    // Find origin for routing (previous job or home base)
    let originLat: number;
    let originLng: number;

    const prevJob = anchoredJobs
      .filter((j) => new Date(j.appointment_time) < appointmentTime)
      .sort(
        (a, b) => +new Date(b.appointment_time) - +new Date(a.appointment_time),
      )[0];

    const nextJob = anchoredJobs
      .filter((j) => new Date(j.appointment_time) >= jobEndsAt)
      .sort(
        (a, b) => +new Date(a.appointment_time) - +new Date(b.appointment_time),
      )[0];

    if (prevJob && prevJob.lat && prevJob.lng) {
      originLat = Number(prevJob.lat);
      originLng = Number(prevJob.lng);
    } else if (settings.home_base_lat && settings.home_base_lng) {
      originLat = Number(settings.home_base_lat);
      originLng = Number(settings.home_base_lng);
    } else {
      // No origin available — can't compute drive time
      return this.decline(
        'No home base configured. Please set your home base in settings.',
        0,
        0,
        dto.fee,
        irsRate,
      );
    }

    // Get drive time + distance from ORS
    const route = await this.getRouteFromORS(
      originLat,
      originLng,
      jobGeo.lat,
      jobGeo.lng,
    );
    if (!route) {
      return this.decline(
        'Could not calculate drive time. Please try again.',
        0,
        0,
        dto.fee,
        irsRate,
      );
    }
    const { distanceMiles, driveTimeMins } = route;

    // Check time conflicts before and after
    let gapBefore: number | null = null;
    let gapAfter: number | null = null;

    if (prevJob) {
      const prevEndsAt = prevJob.signing_ends_at
        ? new Date(prevJob.signing_ends_at)
        : new Date(
            +new Date(prevJob.appointment_time) +
              prevJob.signing_duration_mins * 60_000,
          );
      // gap = time from previous job end until proposed job starts (minus drive time)
      gapBefore =
        Math.floor((+appointmentTime - +prevEndsAt) / 60_000) - driveTimeMins;
    }

    if (nextJob) {
      gapAfter = Math.floor(
        (+new Date(nextJob.appointment_time) - +jobEndsAt) / 60_000,
      );
    }

    // Hard conflict check
    if (gapBefore !== null && gapBefore < 0) {
      const result = this.decline(
        `Conflicts with a prior appointment. Overlap of ${Math.abs(gapBefore)} min.`,
        distanceMiles,
        driveTimeMins,
        dto.fee,
        irsRate,
        gapBefore,
        gapAfter,
        true,
        prevJob,
        nextJob,
      );
      await this.cacheResult(cacheKey, result);
      return result;
    }
    if (gapAfter !== null && gapAfter < 0) {
      const result = this.decline(
        `Conflicts with a later appointment. Overlap of ${Math.abs(gapAfter)} min.`,
        distanceMiles,
        driveTimeMins,
        dto.fee,
        irsRate,
        gapBefore,
        gapAfter,
        true,
        prevJob,
        nextJob,
      );
      await this.cacheResult(cacheKey, result);
      return result;
    }

    // Profitability calculation
    const prof = calculateProfitability({
      fee: dto.fee,
      platformFee: dto.platform_fee ?? 0,
      distanceMiles,
      irsRatePerMile: irsRate,
      signingDurationMins,
      driveTimeMins,
      scanbackDurationMins: scanbackMins,
    });

    // Determine verdict
    const isRiskyGap =
      (gapBefore !== null && gapBefore < MIN_GAP_MINS) ||
      (gapAfter !== null && gapAfter < MIN_GAP_MINS);

    let verdict: CittVerdict;
    let reason: string;

    if (prof.netEarnings < minAcceptableNet) {
      verdict = 'DECLINE';
      reason = `Net earnings of $${prof.netEarnings.toFixed(2)} fall below your $${minAcceptableNet} threshold.`;
    } else if (prof.netEarnings < TAKE_IT_NET || isRiskyGap) {
      verdict = 'RISKY';
      reason = isRiskyGap
        ? `Less than ${MIN_GAP_MINS} min buffer between appointments. Proceed with caution.`
        : `Net earnings of $${prof.netEarnings.toFixed(2)} are marginal.`;
    } else {
      verdict = 'TAKE_IT';
      reason = `You earn $${prof.netEarnings.toFixed(2)} net ($${prof.effectiveHourly.toFixed(2)}/hr effective).`;
    }

    const result: CittResult = {
      verdict,
      reason,
      drive_distance_miles: distanceMiles,
      drive_time_mins: driveTimeMins,
      mileage_cost: prof.mileageCost,
      net_earnings: prof.netEarnings,
      effective_hourly: prof.effectiveHourly,
      total_job_mins: prof.totalJobMins,
      can_make_it: true,
      scanback_conflict: false,
      gap_before: gapBefore,
      gap_after: gapAfter,
      prev_job: prevJob
        ? {
            type: prevJob.signing_type,
            time: prevJob.appointment_time,
            duration: prevJob.signing_duration_mins,
          }
        : null,
      next_job: nextJob
        ? {
            type: nextJob.signing_type,
            time: nextJob.appointment_time,
          }
        : null,
    };

    await this.cacheResult(cacheKey, result);
    return result;
  }

  // ORS Route Lookup

  private async getRouteFromORS(
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number,
  ): Promise<{ distanceMiles: number; driveTimeMins: number } | null> {
    const cacheKey = `ors:${fromLat.toFixed(5)},${fromLng.toFixed(5)}:${toLat.toFixed(5)},${toLng.toFixed(5)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as {
        distanceMiles: number;
        driveTimeMins: number;
      };
    }

    const apiKey = this.config.get<string>('ors.apiKey');
    const baseUrl =
      this.config.get<string>('ors.baseUrl') ??
      'https://api.openrouteservice.org/v2';

    try {
      const response = await axios.post(
        `${baseUrl}/directions/driving-car/json`,
        {
          coordinates: [
            [fromLng, fromLat],
            [toLng, toLat],
          ],
          units: 'mi',
        },
        {
          headers: {
            Authorization: apiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json, application/geo+json',
          },
          timeout: 10_000,
        },
      );
      const summary = (
        response.data as {
          routes?: Array<{
            summary?: { distance: number; duration: number };
          }>;
        }
      ).routes?.[0]?.summary;

      if (!summary) return null;

      const result = {
        distanceMiles: Math.round(summary.distance * 100) / 100,
        driveTimeMins: Math.ceil(summary.duration / 60),
      };

      await this.redis.set(cacheKey, JSON.stringify(result), ORS_CACHE_TTL);
      return result;
    } catch (error) {
      this.logger.error(
        `[CITT] ORS error: ${error.message}${error.response ? ` (Status: ${error.response.status})` : ''}`,
      );
      // Return a safe fallback instead of crashing
      return {
        distanceMiles: 0,
        driveTimeMins: 0,
      };
    }
  }

  // Helpers

  private decline(
    reason: string,
    drive_distance_miles: number,
    drive_time_mins: number,
    fee: number,
    irsRate: number,
    gapBefore: number | null = null,
    gapAfter: number | null = null,
    isScheduleConflict = false,
    prevJob?: {
      signing_type: SigningType;
      appointment_time: Date;
      signing_duration_mins: number;
    } | null,
    nextJob?: {
      signing_type: SigningType;
      appointment_time: Date;
    } | null,
  ): CittResult {
    return {
      verdict: 'DECLINE',
      reason,
      drive_distance_miles,
      drive_time_mins,
      mileage_cost: drive_distance_miles * 2 * irsRate,
      net_earnings: fee - drive_distance_miles * 2 * irsRate,
      effective_hourly: 0,
      total_job_mins: 0,
      gap_before: gapBefore,
      gap_after: gapAfter,
      can_make_it: !isScheduleConflict,
      scanback_conflict: false,
      prev_job: prevJob
        ? {
            type: prevJob.signing_type,
            time: prevJob.appointment_time,
            duration: prevJob.signing_duration_mins,
          }
        : null,
      next_job: nextJob
        ? {
            type: nextJob.signing_type,
            time: nextJob.appointment_time,
          }
        : null,
    };
  }

  private async cacheResult(key: string, result: any): Promise<void> {
    await this.redis.set(key, JSON.stringify(result), CITT_CACHE_TTL);
  }

  private async getSigningDuration(
    userId: string,
    signingType: SigningType,
  ): Promise<number> {
    const defaults = await this.userSettings.getSigningDefaults(userId);
    const match = defaults.find((d) => d.signing_type === signingType);
    return match?.signing_duration_mins ?? 60;
  }
}
