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
import { CreateBookingDto, DeclineBookingDto } from './dto/booking.dto';
import {
  BookingStatus,
  JobStatus,
  JobSource,
  SigningType,
  PlanTier,
} from '../../../generated/prisma';

interface BookingServiceConfig {
  signing_type: SigningType;
  base_fee?: number;
  duration_mins?: number;
  scanback_mins?: number;
}

@Injectable()
export class BookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geocoding: GeocodingService,
    private readonly ors: OrsService,
    private readonly userSettings: UserSettingsService,
    private readonly notifications: NotificationsService,
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
    const services =
      (settings.booking_page_services as unknown as BookingServiceConfig[]) ??
      [];
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
        requested_time: new Date(dto.requested_time),
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
    const services =
      (settings.booking_page_services as unknown as BookingServiceConfig[]) ??
      [];
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

    // Create job from booking
    const job = await this.prisma.job.create({
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
        fee:
          Number(booking.base_fee) + Number(booking.travel_fee_estimate ?? 0),
        platform_fee: 0,
        net_earnings:
          Number(booking.base_fee) + Number(booking.travel_fee_estimate ?? 0),
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

    // Update booking status
    await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.CONFIRMED,
        reviewed_at: new Date(),
        confirmed_at: new Date(),
      },
    });

    // Email the client confirmation
    if (booking.client_email) {
      const notary = await this.prisma.user.findUnique({
        where: { id: notaryId },
      });
      await this.notifications
        .sendEmail({
          to: booking.client_email,
          subject: 'Your signing appointment is confirmed',
          html: `
            <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto">
              <h2 style="color:#0F2C4E">Appointment Confirmed</h2>
              <p>Hi ${booking.client_name},</p>
              <p>Your ${booking.service_type.replace('_', ' ')} signing with ${notary?.full_name ?? notary?.username ?? 'your notary'} is confirmed.</p>
              <p><strong>Date:</strong> ${booking.requested_time.toLocaleString()}</p>
              <p><strong>Location:</strong> ${booking.address}</p>
            </div>
          `,
        })
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
      const altTimes = (dto.alternative_times ?? [])
        .map((t) => new Date(t).toLocaleString())
        .join('<br>');
      await this.notifications
        .sendEmail({
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
        })
        .catch(() => {});
    }

    return { ...booking, status: BookingStatus.DECLINED };
  }

  /** Public: get available slots for a date */
  async getSlots(username: string, date: string, serviceType?: SigningType) {
    const notary = await this.prisma.user.findUnique({ where: { username } });
    if (!notary) throw new NotFoundException('Notary not found');

    if (notary.plan === PlanTier.FREE)
      throw new BadRequestException('Free plan users cannot receive bookings');

    const settings = await this.userSettings.get(notary.id);
    if (!settings.booking_page_enabled) return { slots: [], notary: null };

    // Get active hours for the day
    const day = new Date(date);
    const dayOfWeek = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][
      day.getDay()
    ];
    const activeHoursMap =
      settings.booking_page_active_hours as unknown as Record<
        string,
        { start?: string; end?: string }
      >;
    const activeHours = activeHoursMap?.[dayOfWeek];
    if (!activeHours)
      return { slots: [], notary: this.publicNotaryInfo(notary, settings) };

    const [startH, startM] = (activeHours.start ?? '08:00')
      .split(':')
      .map(Number);
    const [endH, endM] = (activeHours.end ?? '18:00').split(':').map(Number);

    // Get service duration
    const services =
      (settings.booking_page_services as unknown as BookingServiceConfig[]) ??
      [];
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
    },
  ) {
    return {
      full_name: user.full_name,
      username: user.username,
      bio: settings.booking_page_bio,
      service_area_miles: settings.service_area_miles,
      services: settings.booking_page_services ?? [],
    };
  }
}
