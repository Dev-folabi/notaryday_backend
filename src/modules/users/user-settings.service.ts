import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { NavApp, SigningType, Prisma } from '../../../generated/prisma';

export const DEFAULT_NOTIFICATION_PREFS = {
  pre_sign_reminder: true,
  scanback_reminder: true,
  new_booking_received: true,
  job_imported: true,
  payment_received: true,
  plan_expiring: true,
  payment_failed: true,
  client_appointment_reminder: true,
  client_invoice: true,
  client_booking_confirmation: true,
};

export type NotificationPreferenceKey = keyof typeof DEFAULT_NOTIFICATION_PREFS;

export interface NotificationConfig {
  prefs: Record<NotificationPreferenceKey, boolean>;
  remindersEnabled: boolean;
  reminderLeadMins: number;
  clientEtaEnabled: boolean;
}

@Injectable()
export class UserSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Normalize booking page active-hours day keys to lowercase ("mon".."sun")
   * so getSlots (which reads lowercase) works regardless of what the client
   * sent ("Mon", "MON", etc.).
   */
  private normalizeActiveHours(
    value: unknown,
  ): Record<string, { start?: string; end?: string }> | undefined {
    if (typeof value !== 'object' || value === null) return undefined;
    const out: Record<string, { start?: string; end?: string }> = {};
    for (const [day, hours] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const h = (hours ?? {}) as Record<string, unknown>;
      out[day.toLowerCase()] = {
        start: typeof h.start === 'string' ? h.start : undefined,
        end: typeof h.end === 'string' ? h.end : undefined,
      };
    }
    return out;
  }

  /**
   * Coerce arbitrary user-supplied payment_info JSON into the canonical shape
   * { zelle?, venmo?, paypal?, bank_name?, account_last4?, routing_last4?,
   * other? }. Unknown keys are dropped; string values are kept as-is; other
   * scalars are stringified; a non-object (e.g. a plain string like
   * "Zelle: sarah@email.com") is stored under `other` so nothing is lost.
   */
  private normalizePaymentInfo(value: unknown): Prisma.InputJsonValue {
    if (typeof value === 'string') {
      return { other: value };
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { other: String(value) };
    }
    const src = value as Record<string, unknown>;
    const out: Record<string, string> = {};
    const known = [
      'zelle',
      'venmo',
      'paypal',
      'bank_name',
      'account_last4',
      'routing_last4',
      'other',
    ];
    for (const key of known) {
      const v = src[key];
      if (v === undefined || v === null || v === '') continue;
      if (typeof v === 'string') {
        out[key] = v;
      } else if (typeof v === 'number' || typeof v === 'boolean') {
        out[key] = String(v);
      }
    }
    return out;
  }

  async get(userId: string) {
    let settings = await this.prisma.userSettings.findUnique({
      where: { user_id: userId },
    });

    if (!settings) {
      settings = await this.prisma.userSettings.create({
        data: { user_id: userId },
      });
    }

    return settings;
  }

  async getNotificationConfig(userId: string): Promise<NotificationConfig> {
    const settings = await this.get(userId);
    const stored =
      settings.notification_prefs &&
      typeof settings.notification_prefs === 'object' &&
      !Array.isArray(settings.notification_prefs)
        ? (settings.notification_prefs as Record<string, unknown>)
        : {};

    const prefs = { ...DEFAULT_NOTIFICATION_PREFS };
    for (const key of Object.keys(prefs) as NotificationPreferenceKey[]) {
      if (typeof stored[key] === 'boolean') prefs[key] = stored[key];
    }

    return {
      prefs,
      remindersEnabled: settings.reminders_enabled,
      reminderLeadMins: settings.reminder_lead_mins,
      clientEtaEnabled: settings.client_eta_enabled,
    };
  }

  async update(
    userId: string,
    data: {
      home_base_address?: string;
      home_base_lat?: number;
      home_base_lng?: number;
      irs_rate_per_mile?: number;
      vehicle_type?: string;
      min_acceptable_net?: number;
      bookingPageEnabled?: boolean;
      bookingPageBio?: string;
      serviceAreaMiles?: number;
      bookingBufferMins?: number;
      bookingPageActiveHours?: Prisma.InputJsonValue;
      bookingPageServices?: Prisma.InputJsonValue | Record<string, unknown>[];
      bookingMinNoticeHours?: number;
      bookingAdvanceLimitDays?: number;
      paymentInfo?: unknown;
      invoiceNotes?: string;
      invoiceDueDays?: number;
      remindersEnabled?: boolean;
      reminderLeadMins?: number;
      clientEtaEnabled?: boolean;
      preferredNavApp?: NavApp;
      scanback_duration_mins?: number;
      state?: string;
      notificationPrefs?: Record<string, boolean>;
    },
  ) {
    const updateData: {
      home_base_address?: string;
      home_base_lat?: number;
      home_base_lng?: number;
      irs_rate_per_mile?: number;
      vehicle_type?: string;
      min_acceptable_net?: number;
      booking_page_enabled?: boolean;
      booking_page_bio?: string;
      service_area_miles?: number;
      booking_buffer_mins?: number;
      booking_page_active_hours?: Prisma.InputJsonValue;
      booking_page_services?: Prisma.InputJsonValue;
      booking_min_notice_hours?: number;
      booking_advance_limit_days?: number;
      payment_info?: Prisma.InputJsonValue;
      invoice_notes?: string;
      invoice_due_days?: number;
      reminders_enabled?: boolean;
      reminder_lead_mins?: number;
      client_eta_enabled?: boolean;
      preferred_nav_app?: NavApp;
      scanback_duration_mins?: number;
      state?: string;
      notification_prefs?: Prisma.InputJsonValue;
    } = {};
    if (data.home_base_address !== undefined)
      updateData.home_base_address = data.home_base_address;
    if (data.home_base_lat !== undefined)
      updateData.home_base_lat = data.home_base_lat;
    if (data.home_base_lng !== undefined)
      updateData.home_base_lng = data.home_base_lng;
    if (data.irs_rate_per_mile !== undefined)
      updateData.irs_rate_per_mile = data.irs_rate_per_mile;
    if (data.vehicle_type !== undefined)
      updateData.vehicle_type = data.vehicle_type;
    if (data.min_acceptable_net !== undefined)
      updateData.min_acceptable_net = data.min_acceptable_net;
    if (data.bookingPageEnabled !== undefined)
      updateData.booking_page_enabled = data.bookingPageEnabled;
    if (data.bookingPageBio !== undefined)
      updateData.booking_page_bio = data.bookingPageBio;
    if (data.serviceAreaMiles !== undefined)
      updateData.service_area_miles = data.serviceAreaMiles;
    if (data.bookingBufferMins !== undefined)
      updateData.booking_buffer_mins = data.bookingBufferMins;
    if (data.bookingPageActiveHours !== undefined)
      updateData.booking_page_active_hours = this.normalizeActiveHours(
        data.bookingPageActiveHours,
      );
    if (data.bookingPageServices !== undefined)
      updateData.booking_page_services =
        data.bookingPageServices as Prisma.InputJsonValue;
    if (data.bookingMinNoticeHours !== undefined)
      updateData.booking_min_notice_hours = data.bookingMinNoticeHours;
    if (data.bookingAdvanceLimitDays !== undefined)
      updateData.booking_advance_limit_days = data.bookingAdvanceLimitDays;
    if (data.paymentInfo !== undefined)
      updateData.payment_info = this.normalizePaymentInfo(data.paymentInfo);
    if (data.invoiceNotes !== undefined)
      updateData.invoice_notes = data.invoiceNotes;
    if (data.invoiceDueDays !== undefined)
      updateData.invoice_due_days = data.invoiceDueDays;
    if (data.remindersEnabled !== undefined)
      updateData.reminders_enabled = data.remindersEnabled;
    if (data.reminderLeadMins !== undefined)
      updateData.reminder_lead_mins = data.reminderLeadMins;
    if (data.clientEtaEnabled !== undefined)
      updateData.client_eta_enabled = data.clientEtaEnabled;
    if (data.preferredNavApp !== undefined)
      updateData.preferred_nav_app = data.preferredNavApp;
    if (data.scanback_duration_mins !== undefined)
      updateData.scanback_duration_mins = data.scanback_duration_mins;
    if (data.state !== undefined) updateData.state = data.state;
    if (data.notificationPrefs !== undefined)
      updateData.notification_prefs =
        data.notificationPrefs as Prisma.InputJsonValue;

    return this.prisma.userSettings.upsert({
      where: { user_id: userId },
      create: { user_id: userId, ...updateData },
      update: updateData,
    });
  }

  // Signing type defaults
  async getSigningDefaults(userId: string) {
    return this.prisma.signingTypeDefault.findMany({
      where: { user_id: userId },
      orderBy: { signing_type: 'asc' },
    });
  }

  async upsertSigningDefault(
    userId: string,
    signingType: string,
    signingDurationMins: number,
    scanbackDurationMins: number,
  ) {
    return this.prisma.signingTypeDefault.upsert({
      where: {
        user_id_signing_type: {
          user_id: userId,
          signing_type: signingType as SigningType,
        },
      },
      create: {
        user_id: userId,
        signing_type: signingType as SigningType,
        signing_duration_mins: signingDurationMins,
        scanback_duration_mins: scanbackDurationMins,
      },
      update: {
        signing_duration_mins: signingDurationMins,
        scanback_duration_mins: scanbackDurationMins,
      },
    });
  }

  async seedSigningDefaults(userId: string) {
    const defaults = [
      {
        signingType: 'GENERAL',
        signingDurationMins: 30,
        scanbackDurationMins: 0,
      },
      {
        signingType: 'LOAN_REFI',
        signingDurationMins: 60,
        scanbackDurationMins: 20,
      },
      {
        signingType: 'HYBRID',
        signingDurationMins: 75,
        scanbackDurationMins: 18,
      },
      {
        signingType: 'PURCHASE_CLOSING',
        signingDurationMins: 90,
        scanbackDurationMins: 28,
      },
      {
        signingType: 'FIELD_INSPECTION',
        signingDurationMins: 45,
        scanbackDurationMins: 0,
      },
      {
        signingType: 'APOSTILLE',
        signingDurationMins: 20,
        scanbackDurationMins: 0,
      },
    ];

    for (const d of defaults) {
      await this.upsertSigningDefault(
        userId,
        d.signingType,
        d.signingDurationMins,
        d.scanbackDurationMins,
      );
    }
  }

  /** Replace the full set of signing defaults for a user. Any type present in
   *  the DB but absent from `defaults` is deleted (deselected types must take
   *  effect), and the provided entries are upserted. */
  async syncSigningDefaults(
    userId: string,
    defaults: {
      signing_type: string;
      signing_duration_mins: number;
      scanback_duration_mins: number;
    }[],
  ) {
    const types = defaults
      .map((d) => d.signing_type)
      .filter((t): t is SigningType => !!t);

    await this.prisma.signingTypeDefault.deleteMany({
      where: {
        user_id: userId,
        signing_type: { notIn: types },
      },
    });

    for (const d of defaults) {
      if (d.signing_type) {
        await this.upsertSigningDefault(
          userId,
          d.signing_type,
          d.signing_duration_mins,
          d.scanback_duration_mins,
        );
      }
    }
  }
}
