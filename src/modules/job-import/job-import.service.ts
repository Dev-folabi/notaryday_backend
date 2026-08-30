import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { PrismaService } from '../../config/prisma.service';
import { QUEUE_JOB_IMPORT } from '../../queues/queue.constants';
import {
  ImportStatus,
  ImportType,
  JobStatus,
  JobSource,
  SigningType,
} from '../../../generated/prisma';
import { JobsService } from '../jobs/jobs.service';
import { CreateJobDto } from '../jobs/dto/create-job.dto';
import { Resend } from 'resend';

@Injectable()
export class JobImportService {
  private readonly logger = new Logger(JobImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jobsService: JobsService,
    @InjectQueue(QUEUE_JOB_IMPORT) private readonly queue: Queue,
  ) {}

  verifyWebhookSignature(
    payload: Buffer,
    headers: { id?: string; timestamp?: string; signature?: string },
  ): boolean {
    const webhookSecret = this.config.get<string>('RESEND_WEBHOOK_SECRET');
    if (
      !webhookSecret ||
      !headers.id ||
      !headers.timestamp ||
      !headers.signature
    ) {
      return false;
    }

    try {
      const resend = new Resend(
        this.config.get<string>('RESEND_API_KEY') ?? '',
      );
      resend.webhooks.verify({
        webhookSecret,
        payload: payload.toString('utf8'),
        headers: {
          id: headers.id,
          timestamp: headers.timestamp,
          signature: headers.signature,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Handle inbound email webhook from Resend */
  async handleInbound(payload: {
    from: string;
    to?: string[];
    bcc?: string[];
    subject?: string;
    text: string;
    html?: string;
    emailId?: string;
    messageId: string;
  }) {
    const importDomain = this.config
      .get<string>('RESEND_IMPORT_DOMAIN')
      ?.toLowerCase();
    const recipient = this.resolveRecipient(
      [...(payload.to ?? []), ...(payload.bcc ?? [])],
      importDomain,
    );
    if (!recipient) {
      this.logger.warn(
        `Inbound email with no import recipient: to=${(payload.to ?? []).join(',')} bcc=${(payload.bcc ?? []).join(',')}`,
      );
      return { status: 'rejected', reason: 'unknown_recipient' };
    }

    // Route by the import address the email was sent to (import+username@...)
    const user = await this.prisma.user.findUnique({
      where: { username: recipient.username },
    });
    if (!user) {
      this.logger.warn(
        `Inbound email to unknown username: ${recipient.username}`,
      );
      return { status: 'rejected', reason: 'unknown_recipient' };
    }

    // Create import record
    const importRecord = await this.prisma.jobImport.create({
      data: {
        user_id: user.id,
        import_type: ImportType.EMAIL,
        resend_message_id: payload.messageId,
        resend_email_id: payload.emailId ?? null,
        from_address: payload.from,
        recipient_address: recipient.address,
        subject: payload.subject,
        raw_text: payload.text || '',
        raw_html: payload.html,
        status: ImportStatus.QUEUED,
        received_at: new Date(),
      },
    });

    // Queue for AI processing (body is fetched from Resend by the worker).
    // Best-effort: the import record is already persisted, so a slow/down
    // Redis must not fail the Resend webhook; it buffers and flushes once
    // the connection recovers.
    await Promise.race([
      this.queue.add(
        'parse-email',
        { importId: importRecord.id },
        { priority: 1 },
      ),
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]).catch((err) => {
      this.logger.warn(
        `Failed to enqueue email import ${importRecord.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });

    return { status: 'queued', importId: importRecord.id };
  }

  /**
   * Pick the import recipient from the To/Bcc addresses.
   * Supported shapes: import+username@domain or username@import.<domain>.
   */
  private resolveRecipient(
    addresses: string[],
    importDomain?: string,
  ): { username: string; address: string } | null {
    for (const raw of addresses) {
      const address = this.extractAddress(raw)?.toLowerCase();
      if (!address) continue;

      const [localPart, domain] = address.split('@');
      if (!localPart || !domain) continue;

      // Restrict to the configured inbound domain when set
      if (importDomain && domain !== importDomain) continue;

      const local = localPart.trim();

      // import+username@... plus-addressing
      const plusPrefix = 'import+';
      if (local.startsWith(plusPrefix)) {
        const username = local.slice(plusPrefix.length);
        if (username) return { username, address };
        continue;
      }

      // username@import.<domain> subdomain-style
      if (local !== 'import') {
        return { username: local, address };
      }
    }
    return null;
  }

  /** Extract the bare email address from a possibly "Name <email>" value */
  private extractAddress(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/<([^<>]+)>/);
    return (match ? match[1] : trimmed).trim() || null;
  }

  /** Handle uploaded screenshot (saved to R2, enqueued for vision parsing) */
  async handleUpload(
    userId: string,
    file: { originalname: string; buffer: Buffer; mimetype: string },
  ) {
    const r2AccountId = this.config.get<string>('R2_ACCOUNT_ID');
    const accessKeyId = this.config.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('R2_SECRET_ACCESS_KEY');
    const bucket = this.config.get<string>('R2_BUCKET_NAME');

    if (!r2AccountId || !accessKeyId || !secretAccessKey || !bucket) {
      throw new Error(
        'R2 credentials are not fully configured in environment variables.',
      );
    }

    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    const fileKey = `screenshots/${userId}/${Date.now()}-${file.originalname}`;

    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: fileKey,
          Body: file.buffer,
          ContentType: file.mimetype,
        }),
      );
      this.logger.log(`Uploaded screenshot to R2: ${fileKey}`);
    } catch (error) {
      this.logger.error(`R2 Upload failed: ${(error as Error).message}`);
      throw new Error('Failed to upload screenshot');
    }

    // Create import record (unified model; no email sentinels needed)
    const importRecord = await this.prisma.jobImport.create({
      data: {
        user_id: userId,
        import_type: ImportType.SCREENSHOT,
        subject: file.originalname,
        file_key: fileKey,
        file_mimetype: file.mimetype,
        status: ImportStatus.QUEUED,
        received_at: new Date(),
      },
    });

    // Queue for AI vision processing
    try {
      // Best-effort: if Redis/queue is down, give up after 2s; the import
      // record is already persisted and can be re-queued.
      await Promise.race([
        this.queue.add('parse-screenshot', {
          importId: importRecord.id,
          fileKey,
          mimetype: file.mimetype,
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch (err) {
      this.logger.error(
        `Failed to enqueue screenshot parse for ${importRecord.id}`,
        err instanceof Error ? err.stack : String(err),
      );
    }

    return { status: 'queued', importId: importRecord.id };
  }

  /** List imports for a user (excludes confirmed/declined) */
  async findAll(userId: string) {
    return this.prisma.jobImport.findMany({
      where: {
        user_id: userId,
        status: { notIn: [ImportStatus.CONFIRMED, ImportStatus.DECLINED] },
      },
      orderBy: { received_at: 'desc' },
      take: 50,
    });
  }

  /** Get single import */
  async findOne(userId: string, importId: string) {
    const record = await this.prisma.jobImport.findFirst({
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

    const source =
      record.import_type === ImportType.SCREENSHOT
        ? JobSource.SCREENSHOT
        : JobSource.EMAIL_IMPORT;

    // Delegate to the shared job creation pipeline so imported jobs get the
    // same derived fields as manually-added ones: geocoding (lat/lng),
    // signing/scanback end times, mileage from home base, and profitability.
    const appointmentTime = overrides?.appointment_time
      ? new Date(overrides.appointment_time)
      : record.parsed_appointment_time!;

    const dto: CreateJobDto = {
      address: overrides?.address ?? record.parsed_address ?? '',
      appointment_time: appointmentTime.toISOString(),
      signing_type:
        overrides?.signing_type ??
        record.parsed_signing_type ??
        SigningType.GENERAL,
      fee: overrides?.fee ?? Number(record.parsed_fee ?? 0),
      platform_fee:
        overrides?.platform_fee ?? Number(record.parsed_platform_fee ?? 0),
      signing_duration_mins: overrides?.signing_duration_mins,
      scanback_duration_mins: overrides?.scanback_duration_mins,
      client_name:
        overrides?.client_name ?? record.parsed_client_name ?? undefined,
      client_phone: record.parsed_client_phone ?? undefined,
      client_email: record.parsed_client_email ?? undefined,
      platform_name:
        overrides?.platform_name ?? record.parsed_platform_name ?? undefined,
      notes: record.parsed_notes ?? undefined,
      source,
      status: JobStatus.CONFIRMED,
    };

    const job = await this.jobsService.create(userId, dto, undefined, importId);

    await this.prisma.jobImport.update({
      where: { id: importId },
      data: { status: ImportStatus.CONFIRMED },
    });

    return job;
  }

  /** Decline an import (soft; keeps the record, removes it from the list) */
  async decline(userId: string, importId: string) {
    const record = await this.findOne(userId, importId);
    await this.prisma.jobImport.update({
      where: { id: record.id },
      data: { status: ImportStatus.DECLINED },
    });
    return { declined: true, importId: record.id };
  }
}
