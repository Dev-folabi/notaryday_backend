import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { NavApp, SigningType } from '../../../generated/prisma';

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
      homeBaseAddress?: string;
      homeBaseLat?: number;
      homeBaseLng?: number;
      irsRatePerMile?: number;
      vehicleType?: string;
      minAcceptableNet?: number;
      bookingPageEnabled?: boolean;
      bookingPageBio?: string;
      serviceAreaMiles?: number;
      bookingBufferMins?: number;
      bookingPageActiveHours?: any;
      bookingPageServices?: any;
      paymentInfo?: any;
      invoiceNotes?: string;
      invoiceDueDays?: number;
      remindersEnabled?: boolean;
      reminderLeadMins?: number;
      clientEtaEnabled?: boolean;
      preferredNavApp?: NavApp;
    },
  ) {
    const updateData: any = {};
    if (data.homeBaseAddress !== undefined)
      updateData.home_base_address = data.homeBaseAddress;
    if (data.homeBaseLat !== undefined)
      updateData.home_base_lat = data.homeBaseLat;
    if (data.homeBaseLng !== undefined)
      updateData.home_base_lng = data.homeBaseLng;
    if (data.irsRatePerMile !== undefined)
      updateData.irs_rate_per_mile = data.irsRatePerMile;
    if (data.vehicleType !== undefined)
      updateData.vehicle_type = data.vehicleType;
    if (data.minAcceptableNet !== undefined)
      updateData.min_acceptable_net = data.minAcceptableNet;
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
