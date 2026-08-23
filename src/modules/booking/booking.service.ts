import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { GeocodingService } from '../geocoding/geocoding.service';
import { OrsService } from '../../common/services/ors.service';
import { UserSettingsService } from '../users/user-settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailTemplatesService } from '../email-templates/email-templates.service';
import { EmailRendererService } from '../../common/email/email-renderer.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { CreateBookingDto, DeclineBookingDto } from './dto/booking.dto';
import {
  BookingStatus,
  JobStatus,
  JobSource,
  SigningType,
  PlanTier,
  Prisma,
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

type SlotSettings = {
  booking_page_active_hours: unknown;
  booking_page_services: unknown;
  booking_min_notice_hours: number | null;
  booking_advance_limit_days: number | null;
  booking_buffer_mins: number | null;
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
    private readonly emailRenderer: EmailRendererService,
    private readonly analytics: AnalyticsService,
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
    if (requestedTime.getTime() < Date.now()) {
      throw new BadRequestException('Booking time is in the past');
    }
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

    // Get fee from the client's quote when provided; otherwise fall back to
    // the configured service base fee.
    const services = this.normalizeServices(settings.booking_page_services);
    const service = services.find((s) => s.signing_type === dto.service_type);
    const clientFeeProvided =
      typeof dto.base_fee === 'number' && dto.base_fee > 0;
    const baseFee = clientFeeProvided
      ? dto.base_fee!
      : (service?.base_fee ?? 75);

    // Estimate travel fee (only when the client didn't quote a total; when
    // they did, that amount already covers the whole booking).
    let travelFee = 0;
    if (
      !clientFeeProvided &&
      geo &&
      settings.home_base_lat &&
      settings.home_base_lng
    ) {
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

    const totalBlockMins =
      (service?.duration_mins ?? 60) + (service?.scanback_mins ?? 0);
    const bufferMins = settings.booking_buffer_mins ?? 0;

    let booking: Prisma.BookingGetPayload<object>;
    try {
      booking = await this.prisma.$transaction(
        async (tx) => {
          const taken = await this.isSlotBlockTaken(
            notary.id,
            requestedTime,
            totalBlockMins,
            bufferMins,
            { includePending: true, services, client: tx },
          );
          if (taken) {
            throw new ConflictException({
              code: 'SLOT_CONFLICT',
              message: 'That time was just taken. Please pick another slot.',
            });
          }
          return tx.booking.create({
            data: {
              notary_id: notary.id,
              ref: this.generateBookingRef(notary.id),
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
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2034'
      ) {
        throw new ConflictException({
          code: 'SLOT_CONFLICT',
          message: 'That time was just taken. Please pick another slot.',
        });
      }
      throw err;
    }

    // Notify the notary of the new booking request (in-app)
    const notificationConfig = await this.userSettings.getNotificationConfig(
      notary.id,
    );
    if (notificationConfig.prefs.new_booking_received) {
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
      await this.notifications.sendPushToUser(notary.id, {
        title: 'New booking request',
        body: `${dto.client_name} requested a ${dto.service_type.replace('_', ' ')} signing.`,
        url: '/bookings',
        tag: `booking-${booking.id}`,
      });
    }

    this.analytics.track('booking_requested', notary.id, {
      service_type: booking.service_type,
      status: booking.status,
    });

    return booking;
  }

  /** Public: suggest alternative slots near the requested time (race fallback) */
  async suggestAlternatives(
    username: string,
    date: string,
    requestedTime: string,
    serviceType?: SigningType,
  ) {
    const notary = await this.prisma.user.findUnique({ where: { username } });
    if (!notary) throw new NotFoundException('Notary not found');

    if (notary.plan === PlanTier.FREE)
      throw new BadRequestException('Free plan users cannot receive bookings');

    const settings = await this.userSettings.get(notary.id);
    if (!settings.booking_page_enabled) return { slots: [] };

    const services = this.normalizeServices(settings.booking_page_services);
    const service = services.find(
      (s) => s.signing_type === (serviceType ?? SigningType.GENERAL),
    );
    const duration = service?.duration_mins ?? 60;

    const out: {
      time: string;
      iso: string;
      duration_mins: number;
      note: string;
    }[] = [];
    const day = new Date(`${date}T00:00:00`);
    for (let i = 0; i < 14 && out.length < 5; i++) {
      const cursor = new Date(day);
      cursor.setDate(cursor.getDate() + i);
      const cursorDate = `${cursor.getFullYear()}-${String(
        cursor.getMonth() + 1,
      ).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
      const slots = await this.computeSlots(
        notary.id,
        settings,
        cursorDate,
        serviceType ?? SigningType.GENERAL,
      );
      for (const slot of slots) {
        if (cursorDate === date && slot.time === requestedTime) continue;
        out.push({
          ...slot,
          duration_mins: duration,
          note: this.alternativeNote(i, slot.time),
        });
        if (out.length >= 5) break;
      }
    }
    return { slots: out };
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
    const notificationConfig =
      await this.userSettings.getNotificationConfig(notaryId);
    if (
      booking.client_email &&
      notificationConfig.prefs.client_booking_confirmation
    ) {
      const notary = await this.prisma.user.findUnique({
        where: { id: notaryId },
      });
      await this.notifications
        .sendEmail(await this.buildConfirmationEmail(notaryId, notary, booking))
        .catch(() => {});
    }

    // Notify the notary that the booking was approved
    if (notificationConfig.prefs.new_booking_received) {
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
      await this.notifications.sendPushToUser(notaryId, {
        title: 'Booking confirmed',
        body: `${booking.client_name}'s signing was added to your schedule.`,
        url: `/jobs/${job.id}`,
        tag: `booking-confirmed-${booking.id}`,
      });
    }

    this.analytics.track('booking_approved', notaryId, {
      service_type: booking.service_type,
    });

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
    const notificationConfig =
      await this.userSettings.getNotificationConfig(notaryId);
    if (
      booking.client_email &&
      notificationConfig.prefs.client_booking_confirmation
    ) {
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
  ): Promise<{ to: string; subject: string; html: string; text?: string }> {
    const notaryName = notary?.full_name ?? notary?.username ?? 'your notary';
    const timezone = (await this.userSettings.get(notaryId)).timezone ?? null;
    const dateLabel = this.formatInTimezone(booking.requested_time, timezone, {
      dateOnly: true,
    });
    const timeLabel = this.formatInTimezone(booking.requested_time, timezone);
    const contentHtml = this.emailRenderer.detailBlock([
      ['Notary', notaryName],
      ['Date', dateLabel],
      ['Time', timeLabel],
      ['Address', booking.address],
      ['Service', booking.service_type.replace('_', ' ')],
    ]);
    const designed = this.emailRenderer.render({
      title: 'Your signing is booked',
      subtitle: 'Notary Day · Booking confirmation',
      greeting: `Hi ${booking.client_name},`,
      intro: 'Your signing appointment has been confirmed.',
      contentHtml,
      footer: `You will receive a reminder email 24 hours before your appointment. To cancel, contact ${notaryName} directly.`,
      plainText: `Your signing with ${notaryName} is confirmed for ${this.formatInTimezone(booking.requested_time, timezone)} at ${booking.address}.`,
    });
    const fallback = {
      to: booking.client_email,
      subject: 'Your signing appointment is confirmed',
      html: designed.html,
      text: designed.text,
    };
    const rendered = await this.renderBookingEmail(
      notaryId,
      'booking_confirmation',
      booking.client_email,
      {
        client_name: booking.client_name,
        notary_name: notaryName,
        date: dateLabel,
        appointment_time: timeLabel,
        address: booking.address,
        service_type: booking.service_type.replace('_', ' '),
      },
    );
    if (!rendered) return fallback;
    const customized = this.emailRenderer.render({
      title: 'Your signing is booked',
      subtitle: 'Notary Day · Booking confirmation',
      intro: rendered.html,
      contentHtml,
      footer: `To cancel, contact ${notaryName} directly.`,
      plainText: rendered.text,
    });
    return { ...rendered, html: customized.html, text: customized.text };
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
  ): Promise<{ to: string; subject: string; html: string; text?: string }> {
    const notaryName = notary?.full_name ?? notary?.username ?? 'your notary';
    const timezone = (await this.userSettings.get(notaryId)).timezone ?? null;
    const altTimes = (dto.alternative_times ?? []).map((t) =>
      this.formatInTimezone(new Date(t), timezone),
    );
    const altTimesLi = altTimes.map((t) => `<li>${t}</li>`).join('');
    const contentHtml = this.emailRenderer.detailBlock([
      ['Notary', notaryName],
      [
        'Requested time',
        this.formatInTimezone(booking.requested_time, timezone),
      ],
      ['Service', booking.service_type.replace('_', ' ')],
      ...(dto.reason
        ? ([['Reason', dto.reason]] as Array<[string, string]>)
        : []),
    ]);
    const designed = this.emailRenderer.render({
      title: 'Booking update',
      subtitle: 'Notary Day · Booking request',
      greeting: `Hi ${booking.client_name},`,
      intro:
        'Unfortunately, your requested signing time could not be accommodated.',
      contentHtml: `${contentHtml}${altTimesLi ? `<p style="font-size:12px;line-height:1.6;color:#475569"><strong>Alternative times</strong></p><ul style="font-size:12px;line-height:1.6;color:#475569;padding-left:18px;margin:0 0 12px">${altTimesLi}</ul>` : ''}`,
      plainText: `Your booking request for ${this.formatInTimezone(booking.requested_time, timezone)} could not be accommodated.${altTimes.length ? ` Alternative times: ${altTimes.join('; ')}.` : ''}${dto.reason ? ` Reason: ${dto.reason}` : ''}`,
    });
    const fallback = {
      to: booking.client_email,
      subject: 'Update on your signing request',
      html: designed.html,
      text: designed.text,
    };
    const rendered = await this.renderBookingEmail(
      notaryId,
      'booking_declined',
      booking.client_email,
      {
        client_name: booking.client_name,
        notary_name: notaryName,
        date: this.formatInTimezone(booking.requested_time, timezone, {
          dateOnly: true,
        }),
        appointment_time: this.formatInTimezone(
          booking.requested_time,
          timezone,
        ),
        address: '',
        service_type: booking.service_type.replace('_', ' '),
        alternative_times: altTimesLi,
      },
    );
    if (!rendered) return fallback;
    const customized = this.emailRenderer.render({
      title: 'Booking update',
      subtitle: 'Notary Day · Booking request',
      intro: rendered.html,
      contentHtml,
      plainText: rendered.text,
    });
    return { ...rendered, html: customized.html, text: customized.text };
  }

  private async renderBookingEmail(
    notaryId: string,
    type: string,
    to: string,
    vars: Record<string, string>,
  ): Promise<{
    to: string;
    subject: string;
    html: string;
    text: string;
  } | null> {
    try {
      const template = await this.emailTemplates.findByType(notaryId, type);
      if (!template || !template.is_active) return null;
      const rendered = this.emailTemplates.render(template, vars);
      return {
        to,
        subject: rendered.subject,
        html: rendered.body,
        text: rendered.body
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
      };
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

    // Conflict check: any day job whose block (incl. scanback + buffer) overlaps
    // this booking's block, or where there's insufficient drive time.

    const conflictingJobs = dayJobs.filter((j) => {
      const jStart = j.appointment_time.getTime();
      const jEnd = this.jobBlockEnd(j);

      // Direct block overlap (works for both before and after jobs)
      const blockOverlap = !(
        blockEnd + buffer * 60_000 <= jStart || jEnd + buffer * 60_000 <= appt
      );
      if (blockOverlap) return true;
      if (jStart > blockEnd) {
        const driveToNext =
          j.drive_from_prev_mins != null ? j.drive_from_prev_mins : 0;
        if (
          driveToNext > 0 &&
          blockEnd + buffer * 60_000 + driveToNext * 60_000 > jStart
        ) {
          return true;
        }
      }

      // For the job immediately BEFORE the booking: check we can depart in time.
      // driveTimeMins is the drive from that origin to this booking.
      if (driveTimeMins != null && jStart < appt) {
        const jIsImmediatePrev =
          jEnd + buffer * 60_000 + driveTimeMins * 60_000 > appt;
        if (jIsImmediatePrev) return true;
      }

      return false;
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

    const slots = await this.computeSlots(
      notary.id,
      settings,
      date,
      serviceType ?? SigningType.GENERAL,
    );

    return { slots, notary: this.publicNotaryInfo(notary, settings) };
  }

  /**
   * Owner preview: identical slot computation to the public page but skips the
   * plan and booking_page_enabled gates, so the notary can always preview how
   * their own page looks (used by /booking-preview). No bookings can be
   * created through it.
   */
  async getSlotsForOwner(
    userId: string,
    date: string,
    serviceType?: SigningType,
  ): Promise<{
    slots: { time: string; iso: string }[];
    notary: {
      full_name: string | null;
      username: string;
      bio: string | null;
      service_area_miles: number | null;
      services: BookingServiceConfig[];
      active_hours: Record<string, { start?: string; end?: string }> | null;
      min_notice_hours: number | null;
      timezone: string | null;
      timezone_abbr: string | null;
    };
  }> {
    const notary = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!notary) throw new NotFoundException('Notary not found');

    const settings = await this.userSettings.get(notary.id);
    const slots = await this.computeSlots(
      notary.id,
      settings,
      date,
      serviceType ?? SigningType.GENERAL,
    );

    return { slots, notary: this.publicNotaryInfo(notary, settings) };
  }

  private async computeSlots(
    notaryId: string,
    settings: SlotSettings,
    date: string,
    serviceType: SigningType,
  ): Promise<{ time: string; iso: string }[]> {
    const day = new Date(`${date}T00:00:00`);
    const dayOfWeek = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][
      day.getDay()
    ];
    const activeHoursMap = settings.booking_page_active_hours as Record<
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
      return [];

    const [startH, startM] = (activeHours.start ?? '08:00')
      .split(':')
      .map(Number);
    const [endH, endM] = (activeHours.end ?? '18:00').split(':').map(Number);

    // Get service duration
    const services = this.normalizeServices(settings.booking_page_services);
    const service = services.find((s) => s.signing_type === serviceType);
    const duration = service?.duration_mins ?? 60;
    const scanback = service?.scanback_mins ?? 0;
    const totalBlock = duration + scanback;
    const buffer = settings.booking_buffer_mins ?? 0;

    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);
    const lookbackStart = new Date(day.getTime() - 6 * 60 * 60_000);
    const [jobs, pending] = await Promise.all([
      this.prisma.job.findMany({
        where: {
          user_id: notaryId,
          deleted_at: null,
          status: {
            in: [
              JobStatus.CONFIRMED,
              JobStatus.IN_PROGRESS,
              JobStatus.SCANNING,
            ],
          },
          appointment_time: { gte: lookbackStart, lt: nextDay },
        },
        orderBy: { appointment_time: 'asc' },
      }),
      this.prisma.booking.findMany({
        where: {
          notary_id: notaryId,
          deleted_at: null,
          status: BookingStatus.PENDING_REVIEW,
          requested_time: { gte: lookbackStart, lt: nextDay },
        },
      }),
    ]);

    const occupied: { start: number; end: number }[] = [];
    for (const j of jobs) {
      occupied.push({
        start: j.appointment_time.getTime(),
        end: this.jobBlockEnd(j),
      });
    }
    for (const pb of pending) {
      const svc = services.find((s) => s.signing_type === pb.service_type);
      const blockMins = (svc?.duration_mins ?? 60) + (svc?.scanback_mins ?? 0);
      occupied.push({
        start: pb.requested_time.getTime(),
        end: pb.requested_time.getTime() + blockMins * 60_000,
      });
    }

    // Generate 30-min slots within active hours
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const slots: { time: string; iso: string }[] = [];
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

      // Check no overlap with existing jobs / pending requests
      const conflicts = occupied.some((o) =>
        this.overlapsBlock(
          candidateStart.getTime(),
          candidateEnd.getTime(),
          buffer * 60_000,
          o.start,
          o.end,
        ),
      );

      if (!conflicts) {
        const start = new Date(t);
        slots.push({
          time: `${pad2(start.getHours())}:${pad2(start.getMinutes())}`,
          iso: start.toISOString(),
        });
      }
    }

    return slots;
  }

  /** True when [candidateStart, candidateEnd] (each padded by buffer) collides with an occupied block. */
  private overlapsBlock(
    candidateStartMs: number,
    candidateEndMs: number,
    bufferMs: number,
    occupiedStart: number,
    occupiedEnd: number,
  ): boolean {
    return !(
      candidateEndMs + bufferMs <= occupiedStart ||
      candidateStartMs >= occupiedEnd + bufferMs
    );
  }

  private jobBlockEnd(job: {
    appointment_time: Date;
    signing_ends_at: Date | null;
    scanback_ends_at: Date | null;
    signing_duration_mins: number;
    scanback_duration_mins: number;
  }): number {
    const start = job.appointment_time.getTime();
    const derived =
      start +
      ((job.signing_duration_mins ?? 0) + (job.scanback_duration_mins ?? 0)) *
        60_000;
    return Math.max(
      derived,
      job.signing_ends_at ? job.signing_ends_at.getTime() : 0,
      job.scanback_ends_at ? job.scanback_ends_at.getTime() : 0,
    );
  }

  private async isSlotBlockTaken(
    notaryId: string,
    candidateStart: Date,
    totalBlockMins: number,
    bufferMins: number,
    options?: {
      includePending?: boolean;
      services?: BookingServiceConfig[];
      client?: Prisma.TransactionClient;
    },
  ): Promise<boolean> {
    const db = options?.client ?? this.prisma;
    const candidateEnd = candidateStart.getTime() + totalBlockMins * 60_000;
    // Generous window so long signings that begin earlier still get caught.
    const pad = (bufferMins + 240) * 60_000;
    const from = new Date(candidateStart.getTime() - pad);
    const to = new Date(candidateEnd + pad);

    const [jobs, pending] = await Promise.all([
      db.job.findMany({
        where: {
          user_id: notaryId,
          deleted_at: null,
          status: {
            in: [
              JobStatus.CONFIRMED,
              JobStatus.IN_PROGRESS,
              JobStatus.SCANNING,
            ],
          },
          appointment_time: { gte: from, lt: to },
        },
      }),
      options?.includePending
        ? db.booking.findMany({
            where: {
              notary_id: notaryId,
              deleted_at: null,
              status: BookingStatus.PENDING_REVIEW,
              requested_time: { gte: from, lt: to },
            },
          })
        : Promise.resolve([]),
    ]);

    for (const j of jobs) {
      const jEnd = this.jobBlockEnd(j);
      if (
        this.overlapsBlock(
          candidateStart.getTime(),
          candidateEnd,
          bufferMins * 60_000,
          j.appointment_time.getTime(),
          jEnd,
        )
      )
        return true;
    }
    for (const pb of pending) {
      const svc = options?.services?.find(
        (s) => s.signing_type === pb.service_type,
      );
      const blockMins = (svc?.duration_mins ?? 60) + (svc?.scanback_mins ?? 0);
      const start = pb.requested_time.getTime();
      if (
        this.overlapsBlock(
          candidateStart.getTime(),
          candidateEnd,
          bufferMins * 60_000,
          start,
          start + blockMins * 60_000,
        )
      )
        return true;
    }
    return false;
  }

  /** Short human booking reference, e.g. "ND-2608-44821". */
  private generateBookingRef(notaryId: string): string {
    const now = new Date();
    const yymm = `${String(now.getFullYear()).slice(-2)}${String(
      now.getMonth() + 1,
    ).padStart(2, '0')}`;
    let h = 2166136261;
    const seed = `${notaryId}:${now.getTime()}:${Math.random()}`;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const num = Math.abs(h) % 100000;
    return `ND-${yymm}-${String(num).padStart(5, '0')}`;
  }

  private alternativeNote(dayOffset: number, time: string): string {
    if (dayOffset === 0) return 'First available after existing jobs';
    const hour = Number(time.slice(0, 2));
    if (hour < 12) return 'Morning slot';
    if (hour < 17) return 'Afternoon slot';
    return 'Evening slot';
  }

  private publicNotaryInfo(
    user: { full_name: string | null; username: string },
    settings: {
      booking_page_bio: string | null;
      service_area_miles: number | null;
      booking_page_services: unknown;
      booking_page_active_hours: unknown;
      booking_min_notice_hours: number | null;
      timezone?: string | null;
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
      timezone: settings.timezone ?? null,
      timezone_abbr: this.timezoneAbbr(settings.timezone),
    };
  }

  private timezoneAbbr(timezone?: string | null): string | null {
    if (!timezone) return null;
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        timeZoneName: 'short',
      }).formatToParts(new Date());
      return parts.find((p) => p.type === 'timeZoneName')?.value ?? null;
    } catch {
      return null;
    }
  }

  /** Format a Date in the notary's timezone, e.g. "Thursday, March 20, 2026 at 2:00 PM (PDT)". */
  private formatInTimezone(
    date: Date,
    timezone?: string | null,
    opts: { dateOnly?: boolean } = {},
  ): string {
    try {
      const abbr = timezone ? this.timezoneAbbr(timezone) : null;
      const formatted = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone ?? undefined,
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        ...(opts.dateOnly ? {} : { hour: 'numeric', minute: '2-digit' }),
      }).format(date);
      return abbr && !opts.dateOnly ? `${formatted} (${abbr})` : formatted;
    } catch {
      return date.toLocaleString();
    }
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
