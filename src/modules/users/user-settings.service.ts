import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { NavApp, SigningType, Prisma } from '../../../generated/prisma';

@Injectable()
export class UserSettingsService {
  constructor(private readonly prisma: PrismaService) {}

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
      bookingPageServices?: Prisma.InputJsonValue;
      paymentInfo?: Prisma.InputJsonValue;
      invoiceNotes?: string;
      invoiceDueDays?: number;
      remindersEnabled?: boolean;
      reminderLeadMins?: number;
      clientEtaEnabled?: boolean;
      preferredNavApp?: NavApp;
      scanback_duration_mins?: number;
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
      payment_info?: Prisma.InputJsonValue;
      invoice_notes?: string;
      invoice_due_days?: number;
      reminders_enabled?: boolean;
      reminder_lead_mins?: number;
      client_eta_enabled?: boolean;
      preferred_nav_app?: NavApp;
      scanback_duration_mins?: number;
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
      updateData.booking_page_active_hours = data.bookingPageActiveHours;
    if (data.bookingPageServices !== undefined)
      updateData.booking_page_services = data.bookingPageServices;
    if (data.paymentInfo !== undefined)
      updateData.payment_info = data.paymentInfo;
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
}
