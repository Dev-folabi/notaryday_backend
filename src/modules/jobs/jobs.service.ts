import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { RedisService } from '../../config/redis.service';
import { GeocodingService } from '../geocoding/geocoding.service';
import { UserSettingsService } from '../users/user-settings.service';
import { calculateProfitability } from '../../common/utils/profitability.util';
import { haversineMiles } from '../../common/utils/geo.util';
import { OrsService } from '../../common/services/ors.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import {
  JobStatus,
  SigningType,
  JobSource,
  Prisma,
} from '../../../generated/prisma';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import {
  QUEUE_CALENDAR_SYNC,
  QUEUE_NOTIFICATION,
} from '../../queues/queue.constants';
import { NotificationsService } from '../notifications/notifications.service';
import { JournalService } from '../journal/journal.service';
import { InvoicesService } from '../invoices/invoices.service';

// Signing types that mandate scanback
const SCANBACK_TYPES = new Set<SigningType>([
  SigningType.LOAN_REFI,
  SigningType.HYBRID,
  SigningType.PURCHASE_CLOSING,
]);

// Valid forward transitions
const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  [JobStatus.PENDING]: [JobStatus.CONFIRMED, JobStatus.CANCELLED],
  [JobStatus.PENDING_REVIEW]: [JobStatus.CONFIRMED, JobStatus.DECLINED],
  [JobStatus.CONFIRMED]: [JobStatus.IN_PROGRESS, JobStatus.CANCELLED],
  [JobStatus.IN_PROGRESS]: [
    JobStatus.SCANNING,
    JobStatus.COMPLETE,
    JobStatus.CANCELLED,
  ],
  [JobStatus.SCANNING]: [JobStatus.COMPLETE, JobStatus.IN_PROGRESS],
  [JobStatus.COMPLETE]: [],
  [JobStatus.CANCELLED]: [],
  [JobStatus.DECLINED]: [],
};

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly geocoding: GeocodingService,
    private readonly userSettings: UserSettingsService,
    private readonly notifications: NotificationsService,
    private readonly journal: JournalService,
    private readonly ors: OrsService,
    private readonly invoices: InvoicesService,
    @InjectQueue(QUEUE_CALENDAR_SYNC)
    private readonly calendarSyncQueue: Queue,
    @InjectQueue(QUEUE_NOTIFICATION)
    private readonly notificationQueue: Queue,
  ) {}

  // CREATE

  async create(
    userId: string,
    dto: CreateJobDto,
    idempotencyKey?: string,
    importId?: string,
  ) {
    // Idempotency: a client-supplied key means "this is the same logical
    // create" — return the existing job instead of creating a duplicate.
    if (idempotencyKey) {
      const existing = await this.prisma.job.findFirst({
        where: { idempotency_key: idempotencyKey, user_id: userId },
      });
      if (existing) return existing;
    }

    // Get user settings (IRS rate + signing defaults)
    const settings = await this.userSettings.get(userId);
    const irsRate = Number(settings.irs_rate_per_mile);

    // Resolve signing duration from user defaults if not provided
    const signingDurationMins =
      dto.signing_duration_mins ??
      (await this.getSigningDuration(
        userId,
        dto.signing_type ?? SigningType.GENERAL,
      ));

    // Geocode the address
    const geoPoint = await this.geocoding.geocode(dto.address);

    // Mileage: real driving distance from the home base to the job (same
    // source CITT uses), with a straight-line fallback when ORS is
    // unavailable so the job can still be created.
    const { distanceMiles, mileageCost, driveTimeMins } =
      await this.computeMileage(settings, geoPoint, irsRate);

    // Compute signing_ends_at
    const appointmentTime = new Date(dto.appointment_time);
    const signingEndsAt = new Date(
      appointmentTime.getTime() + signingDurationMins * 60_000,
    );

    // Resolve scanback duration
    const signingType = dto.signing_type ?? SigningType.GENERAL;
    const scanbackDurationMins =
      dto.scanback_duration_mins ??
      (SCANBACK_TYPES.has(signingType)
        ? await this.getScanbackDuration(userId, signingType)
        : 0);
    const scanbackEndsAt =
      scanbackDurationMins > 0
        ? new Date(signingEndsAt.getTime() + scanbackDurationMins * 60_000)
        : null;

    // Profitability
    const profitability = calculateProfitability({
      fee: dto.fee,
      platformFee: dto.platform_fee ?? 0,
      distanceMiles,
      irsRatePerMile: irsRate,
      signingDurationMins,
      driveTimeMins,
    });

    // Resolve initial status: explicit DTO wins, otherwise default by source
    const resolvedStatus =
      dto.status ??
      (dto.source === JobSource.MANUAL
        ? JobStatus.CONFIRMED
        : JobStatus.PENDING);

    let job: Awaited<ReturnType<typeof this.prisma.job.create>>;
    try {
      job = await this.prisma.job.create({
        data: {
          user_id: userId,
          address: dto.address,
          lat: geoPoint?.lat,
          lng: geoPoint?.lng,
          appointment_time: appointmentTime,
          signing_duration_mins: signingDurationMins,
          scanback_duration_mins: scanbackDurationMins,
          signing_ends_at: signingEndsAt,
          scanback_ends_at: scanbackEndsAt,
          signing_type: dto.signing_type ?? SigningType.GENERAL,
          source: dto.source,
          fee: dto.fee,
          platform_fee: dto.platform_fee ?? 0,
          mileage_miles: distanceMiles > 0 ? distanceMiles : null,
          mileage_cost: mileageCost > 0 ? mileageCost : null,
          net_earnings: profitability.netEarnings,
          effective_hourly: profitability.effectiveHourly,
          irs_rate_snapshot: irsRate,
          client_name: dto.client_name,
          client_email: dto.client_email,
          client_phone: dto.client_phone,
          platform_name: dto.platform_name,
          signer_count: dto.signer_count ?? 1,
          notes: dto.notes,
          idempotency_key: idempotencyKey,
          import_id: importId,
          status: resolvedStatus,
          confirmed_at:
            resolvedStatus === JobStatus.CONFIRMED ? new Date() : null,
        },
      });
    } catch (err) {
      const prismaError = err as {
        code?: string;
        meta?: { target?: string[] };
      };
      if (
        idempotencyKey &&
        prismaError.code === 'P2002' &&
        prismaError.meta?.target?.includes('idempotency_key')
      ) {
        const existing = await this.prisma.job.findFirst({
          where: { idempotency_key: idempotencyKey, user_id: userId },
        });
        if (existing) return existing;
      }
      throw err;
    }

    await this.invalidateRouteCache(userId, appointmentTime);

    if (job.status === JobStatus.CONFIRMED) {
      try {
        await Promise.race([
          this.calendarSyncQueue.add('sync-job', {
            userId,
            jobId: job.id,
          }),
          new Promise<void>((resolve) => setTimeout(resolve, 2000)),
        ]);
      } catch (err) {
        this.logger.error(
          `Failed to enqueue calendar sync for job ${job.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    return job;
  }

  // LIST

  async findAll(
    userId: string,
    filters?: {
      date?: string;
      status?: JobStatus;
      from?: string;
      to?: string;
    },
  ) {
    const where: {
      user_id: string;
      deleted_at: null;
      status?: JobStatus;
      appointment_time?: { gte?: Date; lt?: Date };
    } = {
      user_id: userId,
      deleted_at: null,
    };

    if (filters?.status) where.status = filters.status;

    if (filters?.date) {
      const day = new Date(filters.date);
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      where.appointment_time = { gte: day, lt: next };
    } else if (filters?.from || filters?.to) {
      const range: { gte?: Date; lt?: Date } = {};
      if (filters.from) range.gte = new Date(filters.from);
      if (filters.to) range.lt = new Date(filters.to);
      where.appointment_time = range;
    }

    return this.prisma.job.findMany({
      where,
      orderBy: { appointment_time: 'asc' },
    });
  }

  // GET ONE

  async findOne(userId: string, jobId: string) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, user_id: userId, deleted_at: null },
      include: { scanback: true, invoice: true },
    });
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }

  // UPDATE

  async update(userId: string, jobId: string, dto: UpdateJobDto) {
    const job = await this.findOne(userId, jobId);

    // Re-geocode if address changed
    const addressChanged =
      dto.address !== undefined && dto.address !== job.address;
    let lat: number | null = job.lat != null ? Number(job.lat) : null;
    let lng: number | null = job.lng != null ? Number(job.lng) : null;
    if (dto.address !== undefined && dto.address !== job.address) {
      const geo = await this.geocoding.geocode(dto.address);
      if (geo) {
        lat = geo.lat;
        lng = geo.lng;
      }
    }

    // If signing type or duration changes, recompute signing_ends_at
    const signingDurationMins =
      dto.signing_duration_mins ??
      (dto.signing_type !== undefined && dto.signing_type !== job.signing_type
        ? await this.getSigningDuration(userId, dto.signing_type)
        : job.signing_duration_mins);
    const appointmentTime = dto.appointment_time
      ? new Date(dto.appointment_time)
      : job.appointment_time;
    const signingEndsAt = new Date(
      appointmentTime.getTime() + signingDurationMins * 60_000,
    );

    // Recompute scanback window when its duration/type changes
    const scanbackDurationMins =
      dto.scanback_duration_mins ??
      (dto.signing_type !== undefined && dto.signing_type !== job.signing_type
        ? await this.getScanbackDuration(userId, dto.signing_type)
        : job.scanback_duration_mins);
    const scanbackEndsAt =
      scanbackDurationMins > 0
        ? new Date(signingEndsAt.getTime() + scanbackDurationMins * 60_000)
        : null;

    const signingWindowChanged =
      (dto.appointment_time !== undefined &&
        new Date(dto.appointment_time).getTime() !==
          job.appointment_time.getTime()) ||
      (dto.signing_duration_mins !== undefined &&
        dto.signing_duration_mins !== job.signing_duration_mins) ||
      (dto.signing_type !== undefined &&
        dto.signing_type !== job.signing_type) ||
      (dto.scanback_duration_mins !== undefined &&
        dto.scanback_duration_mins !== (job.scanback_duration_mins ?? 0));

    const calcChanged =
      addressChanged ||
      dto.fee !== undefined ||
      dto.platform_fee !== undefined ||
      dto.signing_type !== undefined ||
      dto.signing_duration_mins !== undefined ||
      dto.scanback_duration_mins !== undefined;

    const data: Prisma.JobUpdateInput = {
      ...(dto.address !== undefined && { address: dto.address, lat, lng }),
      ...(dto.appointment_time !== undefined && {
        appointment_time: appointmentTime,
      }),
      ...(dto.fee !== undefined && { fee: dto.fee }),
      ...(dto.platform_fee !== undefined && {
        platform_fee: dto.platform_fee,
      }),
      ...(dto.signing_type !== undefined && {
        signing_type: dto.signing_type,
      }),
      ...(dto.signing_duration_mins !== undefined && {
        signing_duration_mins: signingDurationMins,
      }),
      signing_ends_at: signingEndsAt,
      ...(signingWindowChanged &&
        job.status !== JobStatus.SCANNING && {
          scanback_ends_at: scanbackEndsAt,
        }),
      ...(scanbackDurationMins !== (job.scanback_duration_mins ?? 0) && {
        scanback_duration_mins: scanbackDurationMins,
      }),
      ...(dto.client_name !== undefined && { client_name: dto.client_name }),
      ...(dto.client_email !== undefined && {
        client_email: dto.client_email,
      }),
      ...(dto.client_phone !== undefined && {
        client_phone: dto.client_phone,
      }),
      ...(dto.platform_name !== undefined && {
        platform_name: dto.platform_name,
      }),
      ...(dto.notes !== undefined && { notes: dto.notes }),
      ...(dto.signer_count !== undefined && {
        signer_count: dto.signer_count,
      }),
    };

    if (calcChanged) {
      const settings = await this.userSettings.get(userId);
      const irsRate = Number(settings.irs_rate_per_mile);
      const geoPoint =
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        lat != null &&
        lng != null
          ? { lat, lng }
          : null;
      const { distanceMiles, mileageCost, driveTimeMins } =
        await this.computeMileage(settings, geoPoint, irsRate);
      const profitability = calculateProfitability({
        fee: dto.fee ?? job.fee,
        platformFee: dto.platform_fee ?? job.platform_fee ?? 0,
        distanceMiles,
        irsRatePerMile: irsRate,
        signingDurationMins,
        driveTimeMins,
        scanbackDurationMins,
      });
      data.mileage_miles = distanceMiles > 0 ? distanceMiles : null;
      data.mileage_cost = mileageCost > 0 ? mileageCost : null;
      data.net_earnings = profitability.netEarnings;
      data.effective_hourly = profitability.effectiveHourly;
      data.irs_rate_snapshot = irsRate;
    }

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data,
    });

    if (dto.appointment_time !== undefined) {
      await this.invalidateRouteCache(userId, job.appointment_time);
      await this.invalidateRouteCache(userId, appointmentTime);
    }

    // Apply an optional status transition (validated & timestamped)
    if (dto.status !== undefined && dto.status !== updated.status) {
      return this.updateStatus(userId, jobId, dto.status);
    }

    return updated;
  }

  // STATUS TRANSITION

  async updateStatus(userId: string, jobId: string, newStatus: JobStatus) {
    const job = await this.findOne(userId, jobId);
    const allowed = TRANSITIONS[job.status] ?? [];

    if (!allowed.includes(newStatus)) {
      const allowedMsg =
        allowed.length > 0 ? ` Allowed: [${allowed.join(', ')}]` : '';
      throw new BadRequestException(
        `Cannot transition from ${job.status} to ${newStatus}.${allowedMsg}`,
      );
    }

    // Enforce scanback step for scanback-required types
    if (
      newStatus === JobStatus.COMPLETE &&
      job.status === JobStatus.IN_PROGRESS &&
      SCANBACK_TYPES.has(job.signing_type)
    ) {
      throw new BadRequestException(
        `Job type ${job.signing_type} requires SCANNING step before COMPLETE.`,
      );
    }

    const now = new Date();
    const timestamps: Partial<{
      confirmed_at: Date;
      started_at: Date;
      scanning_started_at: Date | null;
      scanback_ends_at: Date | null;
      completed_at: Date;
      cancelled_at: Date;
    }> = {};

    if (newStatus === JobStatus.CONFIRMED) timestamps.confirmed_at = now;
    if (newStatus === JobStatus.IN_PROGRESS) {
      timestamps.started_at = now;
      // Reverting from SCANNING resets the scanback window so the countdown
      // restarts fresh next time signing is marked done.
      if (job.status === JobStatus.SCANNING) {
        timestamps.scanning_started_at = null;
        timestamps.scanback_ends_at = null;
      }
    }
    if (newStatus === JobStatus.SCANNING) {
      timestamps.scanning_started_at = now;
      // Anchor the countdown to the actual start so a late "signing done"
      // doesn't leave the client waiting on a stale planned end time.
      const durationMins = job.scanback_duration_mins ?? 0;
      timestamps.scanback_ends_at =
        durationMins > 0
          ? new Date(now.getTime() + durationMins * 60_000)
          : null;
    }
    if (newStatus === JobStatus.COMPLETE) timestamps.completed_at = now;
    if (newStatus === JobStatus.CANCELLED) timestamps.cancelled_at = now;

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: { status: newStatus, ...timestamps },
    });

    // Auto-create a notarial journal entry once a job is fully complete.
    if (newStatus === JobStatus.COMPLETE) {
      try {
        await this.journal.createForCompletedJob(userId, job);
      } catch (err) {
        this.logger.error(
          `Failed to auto-create journal entry for completed job ${job.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    if (newStatus === JobStatus.COMPLETE) {
      try {
        await this.invoices.generate(userId, job.id);
      } catch (err) {
        this.logger.error(
          `Failed to auto-generate draft invoice for completed job ${job.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    // Dispatch client ETA to next job when signing done
    if (
      (newStatus === JobStatus.SCANNING || newStatus === JobStatus.COMPLETE) &&
      job.status === JobStatus.IN_PROGRESS
    ) {
      this.dispatchClientEta(userId, job).catch(() => {});
    }

    if (
      newStatus === JobStatus.CONFIRMED &&
      job.status !== JobStatus.CONFIRMED
    ) {
      try {
        // Best-effort: never let a slow/down Redis block the response.
        await Promise.race([
          this.calendarSyncQueue.add('sync-job', { userId, jobId: job.id }),
          new Promise<void>((resolve) => setTimeout(resolve, 2000)),
        ]);
      } catch (err) {
        this.logger.error(
          `Failed to enqueue calendar sync for job ${job.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    return updated;
  }

  private async dispatchClientEta(
    userId: string,
    completedJob: { appointment_time: Date },
  ) {
    // Find next confirmed job after this one
    const nextJob = await this.prisma.job.findFirst({
      where: {
        user_id: userId,
        deleted_at: null,
        status: JobStatus.CONFIRMED,
        appointment_time: { gt: completedJob.appointment_time },
      },
      orderBy: { appointment_time: 'asc' },
    });
    if (!nextJob?.client_email) return;

    const driveMins = nextJob.drive_from_prev_mins ?? 20;

    // Queue the client ETA email (processed by NotificationProcessor)
    await this.notificationQueue
      .add('send-client-eta', {
        userId,
        nextJobId: nextJob.id,
        etaMins: driveMins,
      })
      .catch(() => {});

    // In-app notification for the notary that an ETA was dispatched
    await this.notifications
      .createNotification({
        userId,
        type: 'CLIENT_ETA',
        title: 'Client ETA sent',
        body: `Arrival notification sent to ${nextJob.client_name ?? 'your next client'} (~${driveMins} min).`,
        jobId: nextJob.id,
        actionUrl: `/jobs/${nextJob.id}`,
      })
      .catch(() => {});
  }

  // SOFT DELETE

  async remove(userId: string, jobId: string) {
    const job = await this.findOne(userId, jobId);
    const result = await this.prisma.job.update({
      where: { id: jobId },
      data: { deleted_at: new Date() },
    });
    await this.invalidateRouteCache(userId, job.appointment_time);
    return result;
  }

  // Helpers

  /**
   * Driving distance/time from the home base to a geocoded point, using the
   * same ORS source as CITT (real road distance). Falls back to a straight-line
   * (haversine) estimate — with zero drive time — when ORS is unavailable or
   * no home base / geo point is set, so jobs can still be created.
   */
  private async computeMileage(
    settings: Awaited<ReturnType<UserSettingsService['get']>>,
    geoPoint: { lat: number; lng: number } | null,
    irsRate: number,
  ): Promise<{
    distanceMiles: number;
    mileageCost: number;
    driveTimeMins: number;
  }> {
    const homeLat = Number(settings.home_base_lat);
    const homeLng = Number(settings.home_base_lng);
    const hasHome =
      settings.home_base_lat != null &&
      settings.home_base_lng != null &&
      Number.isFinite(homeLat) &&
      Number.isFinite(homeLng);

    if (
      !geoPoint ||
      !hasHome ||
      !Number.isFinite(geoPoint.lat) ||
      !Number.isFinite(geoPoint.lng)
    ) {
      return { distanceMiles: 0, mileageCost: 0, driveTimeMins: 0 };
    }

    let distanceMiles: number;
    let driveTimeMins: number;

    const route = await this.ors.getRoute(
      homeLat,
      homeLng,
      geoPoint.lat,
      geoPoint.lng,
    );
    if (route) {
      distanceMiles = route.distanceMiles;
      driveTimeMins = route.driveTimeMins;
    } else {
      distanceMiles =
        Math.round(
          haversineMiles(homeLat, homeLng, geoPoint.lat, geoPoint.lng) * 100,
        ) / 100;
      driveTimeMins = 0;
    }

    const mileageCost =
      distanceMiles > 0
        ? Math.round(distanceMiles * 2 * irsRate * 100) / 100
        : 0;
    return { distanceMiles, mileageCost, driveTimeMins };
  }

  private async getSigningDuration(
    userId: string,
    signingType: SigningType,
  ): Promise<number> {
    const defaults = await this.userSettings.getSigningDefaults(userId);
    const match = defaults.find((d) => d.signing_type === signingType);
    return match?.signing_duration_mins ?? 60; // fallback
  }

  /** Used externally (CITT) to look up scanback duration for a signing type */
  async getScanbackDuration(
    userId: string,
    signingType: SigningType,
  ): Promise<number> {
    if (!SCANBACK_TYPES.has(signingType)) return 0;
    const defaults = await this.userSettings.getSigningDefaults(userId);
    const match = defaults.find((d) => d.signing_type === signingType);
    return match?.scanback_duration_mins ?? 20;
  }

  private async invalidateRouteCache(userId: string, appointmentTime: Date) {
    const date = appointmentTime.toISOString().slice(0, 10);
    try {
      // Best-effort cache invalidation: a slow/down Redis must never hold the
      // response hostage — the job is already persisted.
      await Promise.race([
        this.redis.del(`route:${userId}:${date}`),
        new Promise<void>((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch (err) {
      this.logger.warn(
        `Route cache invalidation skipped for ${date}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
