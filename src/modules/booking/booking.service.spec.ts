import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { BookingService } from './booking.service';
import { PrismaService } from '../../config/prisma.service';
import { GeocodingService } from '../geocoding/geocoding.service';
import { OrsService } from '../../common/services/ors.service';
import { UserSettingsService } from '../users/user-settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailTemplatesService } from '../email-templates/email-templates.service';
import {
  BookingStatus,
  JobSource,
  JobStatus,
  PlanTier,
  SigningType,
} from '../../../generated/prisma';

const PRO_USER = {
  id: 'notary-1',
  username: 'janenotary',
  full_name: 'Jane Notary',
  plan: PlanTier.PRO,
};

const FREE_USER = {
  id: 'notary-free',
  username: 'freetier',
  full_name: 'Free Notary',
  plan: PlanTier.FREE,
};

function makeSettings(overrides: Record<string, unknown> = {}) {
  return {
    booking_page_enabled: true,
    booking_page_bio: 'Experienced signing agent',
    service_area_miles: 30,
    booking_buffer_mins: 15,
    booking_min_notice_hours: 0,
    booking_advance_limit_days: 30,
    booking_page_services: [
      {
        signing_type: SigningType.GENERAL,
        name: 'General Notary',
        duration_mins: 30,
        scanback_mins: 0,
        base_fee: 75,
      },
      {
        signing_type: SigningType.LOAN_REFI,
        name: 'Loan Refi',
        duration_mins: 60,
        scanback_mins: 20,
        base_fee: 125,
      },
    ],
    booking_page_active_hours: {
      mon: { start: '08:00', end: '18:00' },
      tue: { start: '08:00', end: '18:00' },
      wed: { start: '08:00', end: '18:00' },
      thu: { start: '08:00', end: '18:00' },
      fri: { start: '08:00', end: '18:00' },
      sat: { start: '09:00', end: '16:00' },
    },
    home_base_lat: 30.2672,
    home_base_lng: -97.7431,
    irs_rate_per_mile: 0.67,
    ...overrides,
  };
}

function nextWeekday(targetDay: number, hourOfDay = 0): string {
  const now = new Date();
  now.setDate(now.getDate() + 1);
  const diff = (targetDay - now.getDay() + 7) % 7;
  now.setDate(now.getDate() + diff);
  now.setHours(hourOfDay, 0, 0, 0);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('BookingService', () => {
  let service: BookingService;
  let prisma: {
    user: { findUnique: jest.Mock };
    booking: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    job: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let settingsService: { get: jest.Mock };
  let emailTemplates: { findByType: jest.Mock; render: jest.Mock };

  const tx = {
    booking: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    job: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      booking: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      job: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((fn: (t: typeof tx) => unknown) =>
      fn(tx),
    );

    settingsService = { get: jest.fn().mockResolvedValue(makeSettings()) };
    emailTemplates = {
      findByType: jest.fn().mockResolvedValue(null),
      render: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: GeocodingService,
          useValue: {
            geocode: jest.fn().mockResolvedValue({ lat: 30.3, lng: -97.7 }),
          },
        },
        {
          provide: OrsService,
          useValue: {
            getRoute: jest
              .fn()
              .mockResolvedValue({ distanceMiles: 5, driveTimeMins: 12 }),
          },
        },
        { provide: UserSettingsService, useValue: settingsService },
        {
          provide: NotificationsService,
          useValue: {
            createNotification: jest.fn().mockResolvedValue(undefined),
            sendEmail: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: EmailTemplatesService, useValue: emailTemplates },
      ],
    }).compile();

    jest.clearAllMocks();

    service = module.get<BookingService>(BookingService);
  });

  describe('create', () => {
    const dto = (requested_time: string) => ({
      client_name: 'John Doe',
      client_email: 'john@example.com',
      client_phone: '+15125551234',
      address: '789 Elm St, Austin, TX 78703',
      service_type: SigningType.LOAN_REFI,
      requested_time,
      document_type: 'Deed of Trust',
      notes: '',
    });

    it('rejects FREE plan notaries', async () => {
      prisma.user.findUnique.mockResolvedValue(FREE_USER);
      await expect(
        service.create(
          'freetier',
          dto(new Date(Date.now() + 86400000).toISOString()),
        ),
      ).rejects.toThrow(
        new BadRequestException('Free plan users cannot receive bookings'),
      );
    });

    it('rejects when the booking page is disabled', async () => {
      prisma.user.findUnique.mockResolvedValue(PRO_USER);
      settingsService.get.mockResolvedValue(
        makeSettings({ booking_page_enabled: false }),
      );
      await expect(
        service.create(
          'janenotary',
          dto(new Date(Date.now() + 86400000).toISOString()),
        ),
      ).rejects.toThrow(new BadRequestException('Booking page is not active'));
    });

    it('enforces minimum notice hours', async () => {
      prisma.user.findUnique.mockResolvedValue(PRO_USER);
      settingsService.get.mockResolvedValue(
        makeSettings({ booking_min_notice_hours: 24 }),
      );
      await expect(
        service.create(
          'janenotary',
          dto(new Date(Date.now() + 3600000).toISOString()),
        ),
      ).rejects.toThrow(
        new BadRequestException('Bookings require at least 24 hour(s) notice'),
      );
    });

    it('enforces the advance booking limit', async () => {
      prisma.user.findUnique.mockResolvedValue(PRO_USER);
      settingsService.get.mockResolvedValue(
        makeSettings({ booking_advance_limit_days: 3 }),
      );
      const farFuture = new Date(Date.now() + 10 * 86400000).toISOString();
      await expect(
        service.create('janenotary', dto(farFuture)),
      ).rejects.toThrow(
        new BadRequestException(
          'Bookings can only be made up to 3 day(s) in advance',
        ),
      );
    });

    it('creates a PENDING_REVIEW booking with the configured base fee', async () => {
      prisma.user.findUnique.mockResolvedValue(PRO_USER);
      const created = {
        id: 'bk-1',
        notary_id: 'notary-1',
        status: BookingStatus.PENDING_REVIEW,
        base_fee: 125,
        travel_fee_estimate: 3.35,
      };
      prisma.booking.create.mockResolvedValue(created);

      const result = await service.create(
        'janenotary',
        dto(new Date(Date.now() + 86400000).toISOString()),
      );
      expect(prisma.booking.create).toHaveBeenCalled();
      const createArg = (
        prisma.booking.create.mock.calls as [Record<string, unknown>][]
      )[0][0] as { data: Record<string, unknown> };
      expect(createArg.data.status).toBe(BookingStatus.PENDING_REVIEW);
      expect(createArg.data.service_type).toBe(SigningType.LOAN_REFI);
      expect(createArg.data.base_fee).toBe(125);
      expect(result).toBe(created);
    });
  });

  describe('getSlots', () => {
    it('returns empty slots + null notary when the page is disabled', async () => {
      prisma.user.findUnique.mockResolvedValue(PRO_USER);
      settingsService.get.mockResolvedValue(
        makeSettings({ booking_page_enabled: false }),
      );
      const result = await service.getSlots('janenotary', nextWeekday(1));
      expect(result).toEqual({ slots: [], notary: null });
    });

    it('rejects FREE plan notaries', async () => {
      prisma.user.findUnique.mockResolvedValue(FREE_USER);
      await expect(
        service.getSlots('freetier', nextWeekday(1)),
      ).rejects.toThrow(
        new BadRequestException('Free plan users cannot receive bookings'),
      );
    });

    it('handles capitalized active-hours day keys (legacy frontend format)', async () => {
      prisma.user.findUnique.mockResolvedValue(PRO_USER);
      const date = nextWeekday(1);
      settingsService.get.mockResolvedValue(
        makeSettings({
          booking_page_active_hours: {
            Mon: { start: '08:00', end: '10:00' },
            Tue: { start: '08:00', end: '10:00' },
          },
        }),
      );
      prisma.job.findMany.mockResolvedValue([]);

      const result = await service.getSlots('janenotary', date);
      expect(result.slots.length).toBeGreaterThan(0);
      expect(result.notary!.active_hours).toEqual({
        mon: { start: '08:00', end: '10:00' },
        tue: { start: '08:00', end: '10:00' },
      });
    });

    it('generates 30-min slots within active hours, skipping overlaps', async () => {
      prisma.user.findUnique.mockResolvedValue(PRO_USER);
      const date = nextWeekday(1); // a Monday
      const monday = new Date(`${date}T00:00:00`);

      prisma.job.findMany.mockResolvedValue([
        {
          id: 'job-1',
          appointment_time: new Date(monday.getTime() + 10 * 3600000),
          signing_duration_mins: 60,
          signing_ends_at: new Date(monday.getTime() + 11 * 3600000),
          scanback_ends_at: null,
        },
      ]);

      const result = await service.getSlots('janenotary', date);
      const slotTimes = result.slots.map(
        (s: string) => new Date(s).getHours() * 60 + new Date(s).getMinutes(),
      );
      // 10:00 slot must be skipped (overlaps the confirmed job block 10:00-11:00
      // with 15 min buffer), 11:30 onwards present.
      expect(slotTimes).not.toContain(10 * 60);
      expect(slotTimes).toContain(11 * 60 + 30);
      expect(result.notary).toMatchObject({
        username: 'janenotary',
        min_notice_hours: 0,
      });
      expect(Array.isArray(result.notary!.services)).toBe(true);
    });

    it('filters slots inside the minimum-notice window', async () => {
      prisma.user.findUnique.mockResolvedValue(PRO_USER);
      settingsService.get.mockResolvedValue(
        makeSettings({ booking_min_notice_hours: 24 }),
      );
      prisma.job.findMany.mockResolvedValue([]);

      const date = nextWeekday(1, 4);
      const result = await service.getSlots('janenotary', date);
      const earliestAllowed = Date.now() + 24 * 3600000;
      for (const s of result.slots) {
        expect(new Date(s).getTime()).toBeGreaterThanOrEqual(earliestAllowed);
      }
    });
  });

  describe('approve', () => {
    it('creates a job and confirms the booking inside a transaction', async () => {
      const pendingBooking = {
        id: 'bk-1',
        notary_id: 'notary-1',
        client_name: 'John Doe',
        client_email: 'john@example.com',
        client_phone: '+15125551234',
        address: '789 Elm St',
        lat: 30.3,
        lng: -97.7,
        service_type: SigningType.LOAN_REFI,
        requested_time: new Date(Date.now() + 86400000),
        base_fee: 125,
        travel_fee_estimate: 3.35,
        status: BookingStatus.PENDING_REVIEW,
      };
      prisma.booking.findFirst.mockResolvedValue(pendingBooking);
      const createdJob = { id: 'job-1' };
      prisma.$transaction.mockImplementation(
        (fn: (t: typeof tx) => unknown) => {
          tx.booking.findFirst.mockResolvedValue(pendingBooking);
          tx.job.create.mockResolvedValue(createdJob);
          return fn(tx);
        },
      );

      const result = await service.approve('notary-1', 'bk-1');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(tx.job.create).toHaveBeenCalled();
      const jobArg = (
        tx.job.create.mock.calls as [Record<string, unknown>][]
      )[0][0] as { data: Record<string, unknown> };
      expect(jobArg.data.source).toBe(JobSource.BOOKING_PAGE);
      expect(jobArg.data.status).toBe(JobStatus.CONFIRMED);
      expect(jobArg.data.booking_id).toBe('bk-1');
      expect(jobArg.data.signing_duration_mins).toBe(60);
      expect(jobArg.data.scanback_duration_mins).toBe(20);
      expect(jobArg.data.fee).toBe(128.35);

      expect(tx.booking.update).toHaveBeenCalled();
      const bookingArg = (
        tx.booking.update.mock.calls as [Record<string, unknown>][]
      )[0][0] as { data: Record<string, unknown> };
      expect(bookingArg.data.status).toBe(BookingStatus.CONFIRMED);
      expect(bookingArg.data.confirmed_at).toBeDefined();

      expect(result.job).toBe(createdJob);
    });

    it('rejects approving a non-pending booking', async () => {
      prisma.booking.findFirst.mockResolvedValue({
        id: 'bk-1',
        notary_id: 'notary-1',
        status: BookingStatus.CONFIRMED,
      });
      await expect(service.approve('notary-1', 'bk-1')).rejects.toThrow(
        new BadRequestException('Booking is not pending review'),
      );
    });
  });

  describe('decline', () => {
    it('stores the reason and alternative times and emails the client', async () => {
      prisma.booking.findFirst.mockResolvedValue({
        id: 'bk-1',
        notary_id: 'notary-1',
        client_name: 'John Doe',
        client_email: 'john@example.com',
        service_type: SigningType.LOAN_REFI,
        requested_time: new Date(Date.now() + 86400000),
        status: BookingStatus.PENDING_REVIEW,
      });
      prisma.user.findUnique.mockResolvedValue(PRO_USER);
      prisma.booking.update.mockResolvedValue({ id: 'bk-1' });

      const alt = new Date(Date.now() + 2 * 86400000).toISOString();
      await service.decline('notary-1', 'bk-1', {
        reason: 'Schedule conflict',
        alternative_times: [alt],
      });

      const updateArg = (
        prisma.booking.update.mock.calls as [Record<string, unknown>][]
      )[0][0] as { data: Record<string, unknown> };
      expect(updateArg.data.status).toBe(BookingStatus.DECLINED);
      expect(updateArg.data.declined_reason).toBe('Schedule conflict');
      expect(updateArg.data.alternative_times).toHaveLength(1);
      expect(updateArg.data.reviewed_at).toBeDefined();
    });

    it('rejects declining a non-pending booking', async () => {
      prisma.booking.findFirst.mockResolvedValue({
        id: 'bk-1',
        notary_id: 'notary-1',
        status: BookingStatus.CANCELLED_BY_CLIENT,
      });
      await expect(service.decline('notary-1', 'bk-1', {})).rejects.toThrow(
        new BadRequestException('Booking is not pending review'),
      );
    });
  });

  describe('analyze', () => {
    it('computes profitability and flags conflicting day jobs', async () => {
      const appt = new Date(Date.now() + 86400000);
      prisma.booking.findFirst.mockResolvedValue({
        id: 'bk-1',
        notary_id: 'notary-1',
        service_type: SigningType.LOAN_REFI,
        requested_time: appt,
        lat: 30.3,
        lng: -97.7,
        base_fee: 125,
        travel_fee_estimate: 3.35,
      });
      const day = new Date(appt);
      day.setHours(0, 0, 0, 0);
      // Overlapping job: starts 30 min after booking (block 60+20 min → 11:30 end
      // with buffer 15 → conflict).
      prisma.job.findMany.mockResolvedValue([
        {
          id: 'job-conflict',
          appointment_time: new Date(appt.getTime() + 30 * 60000),
          signing_ends_at: new Date(appt.getTime() + 90 * 60000),
          scanback_ends_at: null,
          signing_duration_mins: 60,
          drive_from_prev_mins: 10,
          drive_from_prev_miles: 4,
        },
        {
          id: 'job-clear',
          appointment_time: new Date(appt.getTime() + 5 * 3600000),
          signing_ends_at: new Date(appt.getTime() + 6 * 3600000),
          scanback_ends_at: null,
          signing_duration_mins: 60,
          drive_from_prev_mins: 12,
          drive_from_prev_miles: 6,
        },
      ]);

      const result = await service.analyze('notary-1', 'bk-1');

      expect(result.profitability.fee).toBe(128.35);
      expect(result.profitability.mileage_cost).toBeDefined();
      expect(result.service.duration_mins).toBe(60);
      expect(result.service.scanback_mins).toBe(20);
      expect(result.conflictingJobIds).toContain('job-conflict');
      expect(result.conflictingJobIds).not.toContain('job-clear');
    });
  });

  describe('cancel', () => {
    it('soft-deletes the linked job and marks the booking cancelled', async () => {
      prisma.booking.findFirst.mockResolvedValue({
        id: 'bk-1',
        notary_id: 'notary-1',
        status: BookingStatus.CONFIRMED,
      });
      prisma.$transaction.mockImplementation(
        (fn: (t: typeof tx) => unknown) => {
          tx.job.findFirst.mockResolvedValue({
            id: 'job-1',
            booking_id: 'bk-1',
          });
          tx.job.update.mockResolvedValue({ id: 'job-1' });
          tx.booking.update.mockResolvedValue({ id: 'bk-1' });
          return fn(tx);
        },
      );

      const result = await service.cancel('notary-1', 'bk-1');

      expect(tx.job.update).toHaveBeenCalled();
      const jobUpdate = (
        tx.job.update.mock.calls as [Record<string, unknown>][]
      )[0][0] as { data: Record<string, unknown> };
      expect(jobUpdate.data.deleted_at).toBeInstanceOf(Date);
      expect(tx.booking.update).toHaveBeenCalled();
      const bookingUpdate = (
        tx.booking.update.mock.calls as [Record<string, unknown>][]
      )[0][0] as { data: Record<string, unknown> };
      expect(bookingUpdate.data.status).toBe(BookingStatus.CANCELLED_BY_CLIENT);
      expect(result.status).toBe(BookingStatus.CANCELLED_BY_CLIENT);
    });

    it('rejects cancelling a non-confirmed booking', async () => {
      prisma.booking.findFirst.mockResolvedValue({
        id: 'bk-1',
        notary_id: 'notary-1',
        status: BookingStatus.PENDING_REVIEW,
      });
      await expect(service.cancel('notary-1', 'bk-1')).rejects.toThrow(
        new BadRequestException('Only confirmed bookings can be cancelled'),
      );
    });
  });
});
