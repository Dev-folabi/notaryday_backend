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
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { JobStatus, SigningType, JobSource } from '../../../generated/prisma';

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
  [JobStatus.SCANNING]: [JobStatus.COMPLETE],
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
  ) {}

  // CREATE

  async create(userId: string, dto: CreateJobDto) {
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

    // Profitability (no drive distance yet — calculated by CITT or route engine)
    const profitability = calculateProfitability({
      fee: dto.fee,
      platformFee: dto.platform_fee ?? 0,
      distanceMiles: 0,
      irsRatePerMile: irsRate,
      signingDurationMins,
      driveTimeMins: 0,
    });

    const job = await this.prisma.job.create({
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
        net_earnings: profitability.netEarnings,
        effective_hourly: profitability.effectiveHourly,
        irs_rate_snapshot: irsRate,
        client_name: dto.client_name,
        client_email: dto.client_email,
        client_phone: dto.client_phone,
        platform_name: dto.platform_name,
        signer_count: dto.signer_count ?? 1,
        notes: dto.notes,
        status:
          dto.source === JobSource.MANUAL
            ? JobStatus.CONFIRMED
            : JobStatus.PENDING,
        confirmed_at: dto.source === JobSource.MANUAL ? new Date() : null,
      },
    });
    await this.invalidateRouteCache(userId, appointmentTime);
    return job;
  }

  // LIST

  async findAll(
    userId: string,
    filters?: { date?: string; status?: JobStatus },
  ) {
    const where: {
      user_id: string;
      deleted_at: null;
      status?: JobStatus;
      appointment_time?: { gte: Date; lt: Date };
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
    let lat = Number(job.lat);
    let lng = Number(job.lng);
    if (dto.address && dto.address !== job.address) {
      const geo = await this.geocoding.geocode(dto.address);
      if (geo) {
        lat = geo.lat;
        lng = geo.lng;
      }
    }

    // If signing type or duration changes, recompute signing_ends_at
    const signingDurationMins =
      dto.signing_duration_mins ?? job.signing_duration_mins;
    const appointmentTime = dto.appointment_time
      ? new Date(dto.appointment_time)
      : job.appointment_time;
    const signingEndsAt = new Date(
      appointmentTime.getTime() + signingDurationMins * 60_000,
    );

    return this.prisma.job.update({
      where: { id: jobId },
      data: {
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
      },
    });
  }

  // STATUS TRANSITION

  async updateStatus(userId: string, jobId: string, newStatus: JobStatus) {
    const job = await this.findOne(userId, jobId);
    const allowed = TRANSITIONS[job.status] ?? [];

    if (!allowed.includes(newStatus)) {
      throw new BadRequestException(
        `Cannot transition from ${job.status} to ${newStatus}. Allowed: [${allowed.join(', ')}]`,
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
      scanning_started_at: Date;
      completed_at: Date;
      cancelled_at: Date;
    }> = {};

    if (newStatus === JobStatus.CONFIRMED) timestamps.confirmed_at = now;
    if (newStatus === JobStatus.IN_PROGRESS) timestamps.started_at = now;
    if (newStatus === JobStatus.SCANNING) timestamps.scanning_started_at = now;
    if (newStatus === JobStatus.COMPLETE) timestamps.completed_at = now;
    if (newStatus === JobStatus.CANCELLED) timestamps.cancelled_at = now;

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: { status: newStatus, ...timestamps },
    });

    // Dispatch client ETA to next job when signing done
    if (
      (newStatus === JobStatus.SCANNING || newStatus === JobStatus.COMPLETE) &&
      job.status === JobStatus.IN_PROGRESS
    ) {
      this.dispatchClientEta(userId, job).catch(() => {});
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
    // Queue notification (uses QUEUE_NOTIFICATION which is registered in WorkersModule)
    await this.redis.set(
      `eta:${nextJob.id}`,
      JSON.stringify({ userId, nextJobId: nextJob.id, etaMins: driveMins }),
      300,
    );
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
    await this.redis.del(`route:${userId}:${date}`);
  }
}
