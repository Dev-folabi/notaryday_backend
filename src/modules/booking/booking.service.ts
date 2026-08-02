import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { GeocodingService } from '../geocoding/geocoding.service';
import { OrsService } from '../../common/services/ors.service';
import { UserSettingsService } from '../users/user-settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailTemplatesService } from '../email-templates/email-templates.service';
import { CreateBookingDto, DeclineBookingDto } from './dto/booking.dto';
import {
  BookingStatus,
  JobStatus,
  JobSource,
  SigningType,
  PlanTier,
} from '../../../generated/prisma';

export interface BookingServiceConfig {
  signing_type?: SigningType;
  name?: string;
  base_fee?: number;
  duration_mins?: number;
  scanback_mins?: number;
  description?: string;
}

type ServiceDefaults = {
  signing_type: SigningType;
  name: string;
  base_fee: number;
  duration_mins: number;
  scanback_mins: number;
};

const DEFAULT_SERVICE_CONFIG: Record<string, ServiceDefaults> = {
  GENERAL: {
    signing_type: SigningType.GENERAL,
    name: 'General Notary',
    duration_mins: 30,
    scanback_mins: 0,
    base_fee: 75,
  },
  LOAN_REFI: {
    signing_type: SigningType.LOAN_REFI,
    name: 'Loan Refi',
    duration_mins: 60,
    scanback_mins: 20,
    base_fee: 75,
  },
  HYBRID: {
    signing_type: SigningType.HYBRID,
    name: 'Hybrid Signing',
    duration_mins: 75,
    scanback_mins: 18,
    base_fee: 75,
  },
  PURCHASE_CLOSING: {
    signing_type: SigningType.PURCHASE_CLOSING,
    name: 'Purchase Closing',
    duration_mins: 90,
    scanback_mins: 28,
    base_fee: 75,
  },
  FIELD_INSPECTION: {
    signing_type: SigningType.FIELD_INSPECTION,
    name: 'Field Inspection',
    duration_mins: 45,
    scanback_mins: 0,
    base_fee: 75,
  },
  APOSTILLE: {
    signing_type: SigningType.APOSTILLE,
    name: 'Apostille',
    duration_mins: 20,
    scanback_mins: 0,
    base_fee: 75,
  },
};

@Injectable()
export class BookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geocoding: GeocodingService,
    private readonly ors: OrsService,
    private readonly userSettings: UserSettingsService,
    private readonly notifications: NotificationsService,
    private readonly emailTemplates: EmailTemplatesService,
  ) {}

  /** Public: create a booking request */
  async create(username: string, dto: CreateBookingDto) {
    const notary = await this.prisma.user.findUnique({ where: { username } });
    if (!notary) throw new NotFoundException('Notary not found');

    if (notary.plan === PlanTier.FREE)
      throw new BadRequestException('Free plan users cannot receive bookings');

    const settings = await this.userSettings.get(notary.id);
    if (!settings.booking_page_enabled)
      throw new BadRequestException('Booking page is not active');

    const requestedTime = new Date(dto.requested_time);
    const minNoticeMs = (settings.booking_min_notice_hours ?? 0) * 60 * 60_000;
    const advanceLimitMs =
      (settings.booking_advance_limit_days ?? 0) * 24 * 60 * 60_000;

    if (requestedTime.getTime() < Date.now() + minNoticeMs) {
      throw new BadRequestException(
        `Bookings require at least ${settings.booking_min_notice_hours ?? 0} hour(s) notice`,
      );
    }
    if (
      advanceLimitMs > 0 &&
      requestedTime.getTime() > Date.now() + advanceLimitMs
    ) {
      throw new BadRequestException(
        `Bookings can only be made up to ${settings.booking_advance_limit_days ?? 0} day(s) in advance`,
      );
    }

    const geo = await this.geocoding.geocode(dto.address);

    // Estimate travel fee
    let travelFee = 0;
    if (geo && settings.home_base_lat && settings.home_base_lng) {
      const route = await this.ors.getRoute(
        Number(settings.home_base_lat),
        Number(settings.home_base_lng),
        geo.lat,
        geo.lng,
      );
      if (route) {
        travelFee =
          Math.round(
            route.distanceMiles * Number(settings.irs_rate_per_mile) * 100,
          ) / 100;
      }
    }

    // Get base fee from services config
    const services = this.normalizeServices(settings.booking_page_services);
    const service = services.find((s) => s.signing_type === dto.service_type);
    const baseFee = service?.base_fee ?? 75;

    const booking = await this.prisma.booking.create({
      data: {
        notary_id: notary.id,
        client_name: dto.client_name,
        client_email: dto.client_email,
        client_phone: dto.client_phone,
        address: dto.address,
        lat: geo?.lat,
        lng: geo?.lng,
        service_type: dto.service_type,
        requested_time: requestedTime,
        document_type: dto.document_type,
        notes: dto.notes,
        base_fee: baseFee,
        travel_fee_estimate: travelFee,
        status: BookingStatus.PENDING_REVIEW,
      },
    });

    // Notify the notary of the new booking request (in-app)
    await this.notifications
      .createNotification({
        userId: notary.id,
        type: 'BOOKING_RECEIVED',
        title: 'New booking request',
        body: `${dto.client_name} requested a ${dto.service_type.replace('_', ' ')} signing on ${new Date(booking.requested_time).toLocaleDateString()}.`,
        bookingId: booking.id,
        actionUrl: '/bookings',
      })
      .catch(() => {});

    return booking;
  }

  /** Auth'd: list bookings for notary */
  async findAll(notaryId: string, status?: BookingStatus) {
    const where: {
      notary_id: string;
      deleted_at: null;
      status?: BookingStatus;
    } = { notary_id: notaryId, deleted_at: null };
    if (status) where.status = status;
    return this.prisma.booking.findMany({
      where,
      orderBy: { submitted_at: 'desc' },
    });
  }

  /** Auth'd: get single booking */
  async findOne(notaryId: string, bookingId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, notary_id: notaryId, deleted_at: null },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  /** Auth'd: approve booking → create job */
  async approve(notaryId: string, bookingId: string) {
    const booking = await this.findOne(notaryId, bookingId);
    if (booking.status !== BookingStatus.PENDING_REVIEW) {
      throw new BadRequestException('Booking is not pending review');
    }

    const settings = await this.userSettings.get(notaryId);
    const services = this.normalizeServices(settings.booking_page_services);
    const service = services.find(
      (s) => s.signing_type === booking.service_type,
    );
    const signingDuration = service?.duration_mins ?? 60;
    const scanbackDuration = service?.scanback_mins ?? 0;

    const appointmentTime = booking.requested_time;
    const signingEndsAt = new Date(
      appointmentTime.getTime() + signingDuration * 60_000,
    );
    const scanbackEndsAt =
      scanbackDuration > 0
        ? new Date(signingEndsAt.getTime() + scanbackDuration * 60_000)
        : null;

    const fee =
      Number(booking.base_fee) + Number(booking.travel_fee_estimate ?? 0);

    // Atomically create the job and confirm the booking. Re-read the booking
    // inside the transaction to prevent double-approval races.
    const { job } = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.booking.findFirst({
        where: { id: bookingId, notary_id: notaryId, deleted_at: null },
      });
      if (!fresh || fresh.status !== BookingStatus.PENDING_REVIEW) {
        throw new BadRequestException('Booking is not pending review');
      }

      const created = await tx.job.create({
        data: {
          user_id: notaryId,
          address: booking.address,
          lat: booking.lat,
          lng: booking.lng,
          appointment_time: appointmentTime,
          signing_duration_mins: signingDuration,
          scanback_duration_mins: scanbackDuration,
          signing_ends_at: signingEndsAt,
          scanback_ends_at: scanbackEndsAt,
          signing_type: booking.service_type,
          source: JobSource.BOOKING_PAGE,
          fee,
          platform_fee: 0,
          net_earnings: fee,
          effective_hourly: 0,
          irs_rate_snapshot: Number(settings.irs_rate_per_mile),
          client_name: booking.client_name,
          client_email: booking.client_email,
          client_phone: booking.client_phone,
          status: JobStatus.CONFIRMED,
          confirmed_at: new Date(),
          booking_id: booking.id,
        },
      });

      await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.CONFIRMED,
          reviewed_at: new Date(),
          confirmed_at: new Date(),
        },
      });

      return { job: created };
    });

    // Email the client confirmation (after the transaction commits)
    if (booking.client_email) {
      const notary = await this.prisma.user.findUnique({
        where: { id: notaryId },
      });
      await this.notifications
        .sendEmail(await this.buildConfirmationEmail(notaryId, notary, booking))
        .catch(() => {});
    }

    // Notify the notary that the booking was approved
    await this.notifications
      .createNotification({
        userId: notaryId,
        type: 'BOOKING_CONFIRMED',
        title: 'Booking confirmed',
        body: `${booking.client_name}'s ${booking.service_type.replace('_', ' ')} signing was added to your schedule.`,
        bookingId: booking.id,
        jobId: job.id,
        actionUrl: `/jobs/${job.id}`,
      })
      .catch(() => {});

    return { booking: { ...booking, status: BookingStatus.CONFIRMED }, job };
  }

  /** Auth'd: decline booking */
  async decline(notaryId: string, bookingId: string, dto: DeclineBookingDto) {
    const booking = await this.findOne(notaryId, bookingId);
    if (booking.status !== BookingStatus.PENDING_REVIEW) {
      throw new BadRequestException('Booking is not pending review');
    }

    await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.DECLINED,
        declined_reason: dto.reason,
        alternative_times: dto.alternative_times?.map((t) => new Date(t)) ?? [],
        reviewed_at: new Date(),
      },
    });

    // Email the client about the decline + alternatives
    if (booking.client_email) {
      const notary = await this.prisma.user.findUnique({
        where: { id: notaryId },
      });
      await this.notifications
        .sendEmail(await this.buildDeclineEmail(notaryId, notary, booking, dto))
        .catch(() => {});
    }

    return { ...booking, status: BookingStatus.DECLINED };
  }

  private async buildConfirmationEmail(
    notaryId: string,
    notary: { full_name: string | null; username: string } | null,
    booking: {
      client_name: string;
      client_email: string;
      service_type: SigningType;
      requested_time: Date;
      address: string;
    },
  ): Promise<{ to: string; subject: string; html: string }> {
    const notaryName = notary?.full_name ?? notary?.username ?? 'your notary';
    const fallback = {
      to: booking.client_email,
      subject: 'Your signing appointment is confirmed',
      html: `
        <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#0F2C4E">Appointment Confirmed</h2>
          <p>Hi ${booking.client_name},</p>
          <p>Your ${booking.service_type.replace('_', ' ')} signing with ${notaryName} is confirmed.</p>
          <p><strong>Date:</strong> ${booking.requested_time.toLocaleString()}</p>
          <p><strong>Location:</strong> ${booking.address}</p>
        </div>
      `,
    };
    const rendered = await this.renderBookingEmail(
      notaryId,
      'booking_confirmation',
      booking.client_email,
      {
        client_name: booking.client_name,
        notary_name: notaryName,
        date: booking.requested_time.toLocaleDateString(),
        appointment_time: booking.requested_time.toLocaleString(),
        address: booking.address,
        service_type: booking.service_type.replace('_', ' '),
      },
    );
    return rendered ?? fallback;
  }

  private async buildDeclineEmail(
    notaryId: string,
    notary: { full_name: string | null; username: string } | null,
    booking: {
      client_name: string;
      client_email: string;
      service_type: SigningType;
      requested_time: Date;
    },
    dto: DeclineBookingDto,
  ): Promise<{ to: string; subject: string; html: string }> {
    const notaryName = notary?.full_name ?? notary?.username ?? 'your notary';
    const altTimes = (dto.alternative_times ?? [])
      .map((t) => new Date(t).toLocaleString())
      .join('<br>');
    const fallback = {
      to: booking.client_email,
      subject: 'Update on your signing request',
      html: `
        <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#0F2C4E">Booking Update</h2>
          <p>Hi ${booking.client_name},</p>
          <p>Unfortunately, ${booking.service_type.replace('_', ' ')} signing request for ${booking.requested_time.toLocaleString()} could not be accommodated${dto.reason ? `: ${dto.reason}` : '.'}</p>
          ${altTimes ? `<p>Alternative times you may request:<br>${altTimes}</p>` : ''}
        </div>
      `,
    };
    const rendered = await this.renderBookingEmail(
      notaryId,
      'booking_declined',
      booking.client_email,
      {
        client_name: booking.client_name,
        notary_name: notaryName,
        date: booking.requested_time.toLocaleDateString(),
        appointment_time: booking.requested_time.toLocaleString(),
        address: '',
        service_type: booking.service_type.replace('_', ' '),
        alternative_times: altTimes,
      },
    );
    return rendered ?? fallback;
  }

  private async renderBookingEmail(
    notaryId: string,
    type: string,
    to: string,
    vars: Record<string, string>,
  ): Promise<{ to: string; subject: string; html: string } | null> {
    try {
      const template = await this.emailTemplates.findByType(notaryId, type);
      if (!template) return null;
      const rendered = this.emailTemplates.render(template, vars);
      return { to, subject: rendered.subject, html: rendered.body };
    } catch {
      return null;
    }
  }

  /** Auth'd: profitability + schedule-conflict analysis for a booking review */
  async analyze(notaryId: string, bookingId: string) {
    const booking = await this.findOne(notaryId, bookingId);
    const settings = await this.userSettings.get(notaryId);

    const day = new Date(booking.requested_time);
    day.setHours(0, 0, 0, 0);
    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);

    const dayJobs = await this.prisma.job.findMany({
      where: {
        user_id: notaryId,
        deleted_at: null,
        appointment_time: { gte: day, lt: nextDay },
      },
      orderBy: { appointment_time: 'asc' },
    });

    const services = this.normalizeServices(settings.booking_page_services);
    const service = services.find(
      (s) => s.signing_type === booking.service_type,
    );
    const signingDuration = service?.duration_mins ?? 60;
    const scanbackDuration = service?.scanback_mins ?? 0;
    const buffer = settings.booking_buffer_mins ?? 0;

    const appt = booking.requested_time.getTime();
    const blockEnd = appt + (signingDuration + scanbackDuration) * 60_000;

    // Drive time from the previous job (or home base when it's the first job)
    const previous = [...dayJobs]
      .reverse()
      .find((j) => j.appointment_time.getTime() < appt);
    let driveTimeMins: number | null = previous
      ? previous.drive_from_prev_mins
      : null;
    let driveMiles: number | null = previous
      ? Number(previous.drive_from_prev_miles ?? 0)
      : null;

    if (
      (driveTimeMins === null || driveMiles === null) &&
      booking.lat &&
      booking.lng
    ) {
      const origin: [number, number] | null =
        previous?.lat && previous?.lng
          ? [Number(previous.lat), Number(previous.lng)]
          : settings.home_base_lat && settings.home_base_lng
            ? [Number(settings.home_base_lat), Number(settings.home_base_lng)]
            : null;
      if (origin) {
        const route = await this.ors.getRoute(
          origin[0],
          origin[1],
          Number(booking.lat),
          Number(booking.lng),
        );
        if (route) {
          driveTimeMins = route.driveTimeMins;
          driveMiles = route.distanceMiles;
        }
      }
    }

    // Conflict check: any day job whose block (incl. scanback + buffer) or
    // approach drive overlaps this booking's block.
    const conflictingJobs = dayJobs.filter((j) => {
      const jStart = j.appointment_time.getTime();
      const jEnd = (
        j.scanback_ends_at ??
        j.signing_ends_at ??
        new Date(jStart + j.signing_duration_mins * 60_000)
      ).getTime();
      const driveOverlap =
        driveTimeMins != null &&
        jStart - appt < driveTimeMins * 60_000 &&
        jStart >= appt;
      const blockOverlap = !(
        blockEnd + buffer * 60_000 <= jStart ||
        appt - (driveTimeMins ?? 0) * 60_000 >= jEnd + buffer * 60_000
      );
      return driveOverlap || blockOverlap;
    });

    const irsRate = Number(settings.irs_rate_per_mile ?? 0.67);
    const mileageCost =
      driveMiles != null
        ? Math.round(driveMiles * 2 * irsRate * 100) / 100
        : null;
    const fee =
      Number(booking.base_fee) + Number(booking.travel_fee_estimate ?? 0);
    const net =
      mileageCost != null ? Math.round((fee - mileageCost) * 100) / 100 : fee;
    const totalTimeMins =
      (driveTimeMins ?? 0) + signingDuration + scanbackDuration;
    const effectiveHourly =
      totalTimeMins > 0 ? Math.round((net / totalTimeMins) * 60) : 0;

    return {
      booking,
      dayJobs,
      conflictingJobIds: conflictingJobs.map((j) => j.id),
      service: {
        duration_mins: signingDuration,
        scanback_mins: scanbackDuration,
      },
      drive: {
        drive_time_mins: driveTimeMins,
        drive_distance_miles: driveMiles,
      },
      profitability: {
        fee,
        mileage_cost: mileageCost,
        net_earnings: net,
        effective_hourly: effectiveHourly,
        total_time_mins: totalTimeMins,
        buffer_mins: buffer,
      },
      buffer_mins: buffer,
    };
  }

  /** Auth'd: cancel a confirmed booking (releases its linked job) */
  async cancel(notaryId: string, bookingId: string) {
    const booking = await this.findOne(notaryId, bookingId);
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException('Only confirmed bookings can be cancelled');
    }

    await this.prisma.$transaction(async (tx) => {
      const job = await tx.job.findFirst({
        where: { booking_id: bookingId, user_id: notaryId, deleted_at: null },
      });
      if (job) {
        await tx.job.update({
          where: { id: job.id },
          data: { deleted_at: new Date() },
        });
      }
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.CANCELLED_BY_CLIENT,
          reviewed_at: new Date(),
        },
      });
    });

    return { ...booking, status: BookingStatus.CANCELLED_BY_CLIENT };
  }

  /** Public: get available slots for a date */
  async getSlots(username: string, date: string, serviceType?: SigningType) {
    const notary = await this.prisma.user.findUnique({ where: { username } });
    if (!notary) throw new NotFoundException('Notary not found');

    if (notary.plan === PlanTier.FREE)
      throw new BadRequestException('Free plan users cannot receive bookings');

    const settings = await this.userSettings.get(notary.id);
    if (!settings.booking_page_enabled) return { slots: [], notary: null };

    // Get active hours for the day. `date` is a calendar date ("YYYY-MM-DD");
    // parse it as local midnight so day-of-week and slot hours match the
    // notary's local day rather than UTC.
    const day = new Date(`${date}T00:00:00`);
    const dayOfWeek = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][
      day.getDay()
    ];
    const activeHoursMap =
      settings.booking_page_active_hours as unknown as Record<
        string,
        { start?: string; end?: string }
      >;
    const lowerHours: Record<string, { start?: string; end?: string }> = {};
    for (const [k, v] of Object.entries(activeHoursMap ?? {}))
      lowerHours[k.toLowerCase()] = v;
    const activeHours = lowerHours[dayOfWeek];
    if (
      !activeHours ||
      !activeHours.start ||
      !activeHours.end ||
      !activeHours.start.includes(':') ||
      !activeHours.end.includes(':')
    )
      return { slots: [], notary: this.publicNotaryInfo(notary, settings) };

    const [startH, startM] = (activeHours.start ?? '08:00')
      .split(':')
      .map(Number);
    const [endH, endM] = (activeHours.end ?? '18:00').split(':').map(Number);

    // Get service duration
    const services = this.normalizeServices(settings.booking_page_services);
    const service = services.find(
      (s) => s.signing_type === (serviceType ?? SigningType.GENERAL),
    );
    const duration = service?.duration_mins ?? 60;
    const scanback = service?.scanback_mins ?? 0;
    const totalBlock = duration + scanback;

    // Load confirmed jobs for the date
    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);
    const jobs = await this.prisma.job.findMany({
      where: {
        user_id: notary.id,
        deleted_at: null,
        status: {
          in: [JobStatus.CONFIRMED, JobStatus.IN_PROGRESS, JobStatus.SCANNING],
        },
        appointment_time: { gte: day, lt: nextDay },
      },
      orderBy: { appointment_time: 'asc' },
    });

    // Generate 30-min slots within active hours
    const buffer = settings.booking_buffer_mins;
    const slots: string[] = [];
    const slotStart = new Date(day);
    slotStart.setHours(startH, startM, 0, 0);
    const slotEnd = new Date(day);
    slotEnd.setHours(endH, endM, 0, 0);

    for (
      let t = slotStart.getTime();
      t + totalBlock * 60_000 <= slotEnd.getTime();
      t += 30 * 60_000
    ) {
      const candidateStart = new Date(t);
      const candidateEnd = new Date(t + totalBlock * 60_000);

      // Enforce minimum notice and advance limit rules
      const minNoticeMs =
        (settings.booking_min_notice_hours ?? 0) * 60 * 60_000;
      const advanceLimitMs =
        (settings.booking_advance_limit_days ?? 0) * 24 * 60 * 60_000;
      if (candidateStart.getTime() < Date.now() + minNoticeMs) continue;
      if (
        advanceLimitMs > 0 &&
        candidateStart.getTime() > Date.now() + advanceLimitMs
      )
        continue;

      // Check no overlap with existing jobs (including their scanback)
      const conflicts = jobs.some((j) => {
        const jobStart = j.appointment_time.getTime();
        const jobEnd = (
          j.scanback_ends_at ??
          j.signing_ends_at ??
          new Date(jobStart + j.signing_duration_mins * 60_000)
        ).getTime();
        const jobWithBuffer = jobEnd + buffer * 60_000;
        const candidateWithBuffer = candidateEnd.getTime() + buffer * 60_000;

        return !(
          candidateWithBuffer <= jobStart ||
          candidateStart.getTime() >= jobWithBuffer
        );
      });

      if (!conflicts) {
        slots.push(candidateStart.toISOString());
      }
    }

    return { slots, notary: this.publicNotaryInfo(notary, settings) };
  }

  private publicNotaryInfo(
    user: { full_name: string | null; username: string },
    settings: {
      booking_page_bio: string | null;
      service_area_miles: number | null;
      booking_page_services: unknown;
      booking_page_active_hours: unknown;
      booking_min_notice_hours: number | null;
    },
  ) {
    const activeHours = settings.booking_page_active_hours as Record<
      string,
      { start?: string; end?: string }
    >;
    const normalizedHours: Record<string, { start?: string; end?: string }> =
      {};
    for (const [k, v] of Object.entries(activeHours ?? {}))
      normalizedHours[k.toLowerCase()] = v;
    return {
      full_name: user.full_name,
      username: user.username,
      bio: settings.booking_page_bio,
      service_area_miles: settings.service_area_miles,
      services: this.normalizeServices(settings.booking_page_services),
      active_hours: Object.keys(normalizedHours).length
        ? normalizedHours
        : null,
      min_notice_hours: settings.booking_min_notice_hours ?? null,
    };
  }

  /**
   * Coerce legacy/loose booking_page_services JSON into the canonical shape:
   * { signing_type, name, duration_mins, scanback_mins, base_fee, description? }
   * Handles display-name strings ("Loan Refi") and old objects without
   * signing_type, falling back to sane defaults.
   */
  private normalizeServices(raw: unknown): BookingServiceConfig[] {
    if (!Array.isArray(raw)) return [];
    const out: BookingServiceConfig[] = [];
    for (const item of raw) {
      if (typeof item === 'string') {
        const st = this.signingTypeFromName(item);
        if (!st) continue;
        out.push({ ...DEFAULT_SERVICE_CONFIG[st] });
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      const it = item as Record<string, unknown>;
      const declaredType = it.signing_type ?? it.type;
      const rawName = it.name;
      const st =
        (typeof declaredType === 'string'
          ? (declaredType.toUpperCase().replace(/[\s-]/g, '_') as SigningType)
          : undefined) ??
        (typeof rawName === 'string'
          ? this.signingTypeFromName(rawName)
          : undefined);
      if (!st || !(st in DEFAULT_SERVICE_CONFIG)) continue;
      const defaults = DEFAULT_SERVICE_CONFIG[st];
      const name =
        (typeof rawName === 'string' ? rawName : undefined) ??
        defaults.name ??
        st;
      out.push({
        signing_type: st,
        name,
        duration_mins: this.toNumber(it.duration_mins, defaults.duration_mins),
        scanback_mins: this.toNumber(it.scanback_mins, defaults.scanback_mins),
        base_fee: this.toNumber(it.base_fee, defaults.base_fee),
        description:
          typeof it.description === 'string' ? it.description : undefined,
      });
    }
    return out;
  }

  private toNumber(value: unknown, fallback: number): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  private signingTypeFromName(name: string): SigningType | undefined {
    const normalized = name
      .toLowerCase()
      .replace(/[_-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const map: Record<string, SigningType> = {
      general: SigningType.GENERAL,
      'general notary': SigningType.GENERAL,
      'general notarisation': SigningType.GENERAL,
      'general notarization': SigningType.GENERAL,
      'loan refi': SigningType.LOAN_REFI,
      'loan refinance': SigningType.LOAN_REFI,
      hybrid: SigningType.HYBRID,
      'hybrid signing': SigningType.HYBRID,
      'purchase closing': SigningType.PURCHASE_CLOSING,
      'field inspection': SigningType.FIELD_INSPECTION,
      apostille: SigningType.APOSTILLE,
    };
    return map[normalized];
  }
}
