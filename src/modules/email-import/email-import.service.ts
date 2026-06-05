import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../config/prisma.service';
import { QUEUE_EMAIL_IMPORT } from '../../queues/queue.constants';
import {
  ImportStatus,
  JobStatus,
  JobSource,
  SigningType,
} from '../../../generated/prisma';
import { UserSettingsService } from '../users/user-settings.service';

@Injectable()
export class EmailImportService {
  private readonly logger = new Logger(EmailImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userSettings: UserSettingsService,
    @InjectQueue(QUEUE_EMAIL_IMPORT) private readonly queue: Queue,
  ) {}

  /** Handle inbound email webhook from Resend */
  async handleInbound(payload: {
    from: string;
    subject?: string;
    text: string;
    html?: string;
    messageId: string;
  }) {
    // Match sender to a user
    const user = await this.prisma.user.findFirst({
      where: { email: payload.from },
    });
    if (!user) {
      this.logger.warn(`Inbound email from unknown sender: ${payload.from}`);
      return { status: 'rejected', reason: 'unknown_sender' };
    }

    // Create import record
    const importRecord = await this.prisma.emailImport.create({
      data: {
        user_id: user.id,
        resend_message_id: payload.messageId,
        from_address: payload.from,
        subject: payload.subject,
        raw_text: payload.text,
        raw_html: payload.html,
        status: ImportStatus.QUEUED,
        received_at: new Date(),
      },
    });

    // Queue for AI processing
    await this.queue.add(
      'parse-email',
      { importId: importRecord.id },
      { priority: 1 },
    );

    return { status: 'queued', importId: importRecord.id };
  }

  /** List imports for a user */
  async findAll(userId: string) {
    return this.prisma.emailImport.findMany({
      where: { user_id: userId },
      orderBy: { received_at: 'desc' },
      take: 50,
    });
  }

  /** Get single import */
  async findOne(userId: string, importId: string) {
    const record = await this.prisma.emailImport.findFirst({
      where: { id: importId, user_id: userId },
    });
    if (!record) throw new NotFoundException('Import not found');
    return record;
  }

  /** Confirm import → create job */
  async confirm(
    userId: string,
    importId: string,
    overrides?: {
      address?: string;
      appointment_time?: string | Date;
      signing_type?: SigningType;
      signing_duration_mins?: number;
      scanback_duration_mins?: number;
      fee?: number;
      platform_fee?: number;
      client_name?: string;
      platform_name?: string;
    },
  ) {
    const record = await this.findOne(userId, importId);
    if (record.status !== ImportStatus.COMPLETE) {
      throw new Error('Import is not ready for confirmation');
    }

    const settings = await this.userSettings.get(userId);
    const irsRate = Number(settings.irs_rate_per_mile);

    const job = await this.prisma.job.create({
      data: {
        user_id: userId,
        address: overrides?.address ?? record.parsed_address ?? '',
        appointment_time: overrides?.appointment_time
          ? new Date(overrides.appointment_time)
          : record.parsed_appointment_time!,
        signing_type:
          overrides?.signing_type ?? record.parsed_signing_type ?? 'GENERAL',
        signing_duration_mins: overrides?.signing_duration_mins ?? 60,
        scanback_duration_mins: overrides?.scanback_duration_mins ?? 0,
        fee: overrides?.fee ?? Number(record.parsed_fee ?? 0),
        platform_fee:
          overrides?.platform_fee ?? Number(record.parsed_platform_fee ?? 0),
        net_earnings: overrides?.fee ?? Number(record.parsed_fee ?? 0),
        effective_hourly: 0,
        irs_rate_snapshot: irsRate,

        client_name: overrides?.client_name ?? record.parsed_client_name,
        platform_name: overrides?.platform_name ?? record.parsed_platform_name,
        source: JobSource.EMAIL_IMPORT,
        status: JobStatus.PENDING,
        email_import_id: importId,
      },
    });

    return job;
  }
}
