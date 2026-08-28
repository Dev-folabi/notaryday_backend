import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { PrismaService } from '../config/prisma.service';
import { QUEUE_JOB_IMPORT } from '../queues/queue.constants';
import { ImportStatus } from '../../generated/prisma';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { UserSettingsService } from '../modules/users/user-settings.service';
import { EmailRendererService } from '../common/email/email-renderer.service';
import { AnalyticsService } from '../modules/analytics/analytics.service';
import { JobExtractionService } from '../modules/job-import/extraction/job-extraction.service';
import { ExtractionOutcome } from '../modules/job-import/extraction/extraction.types';

const PARSE_EMAIL = 'parse-email';
const PARSE_SCREENSHOT = 'parse-screenshot';

@Processor(QUEUE_JOB_IMPORT)
export class JobImportProcessor {
  private readonly logger = new Logger(JobImportProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly userSettings: UserSettingsService,
    private readonly emailRenderer: EmailRendererService,
    private readonly analytics: AnalyticsService,
    private readonly extraction: JobExtractionService,
  ) {}

  @Process(PARSE_EMAIL)
  async handleParseEmail(job: Job<{ importId: string }>) {
    const { importId } = job.data;
    const record = await this.prisma.jobImport.findUnique({
      where: { id: importId },
    });
    if (!record) return;

    await this.prisma.jobImport.update({
      where: { id: importId },
      data: { status: ImportStatus.PROCESSING },
    });

    try {
      // The Resend webhook is metadata-only; fetch the body when missing
      const rawText =
        record.raw_text || (await this.fetchEmailBody(record.resend_email_id));
      if (rawText && rawText !== record.raw_text) {
        await this.prisma.jobImport.update({
          where: { id: importId },
          data: { raw_text: rawText },
        });
      }

      const outcome = await this.extraction.extractFromEmail(rawText);
      await this.finishOutcome(importId, record.user_id, outcome, 'email');
    } catch (error) {
      await this.handleError(importId, error);
    }
  }

  @Process(PARSE_SCREENSHOT)
  async handleParseScreenshot(
    job: Job<{ importId: string; fileKey: string; mimetype: string }>,
  ) {
    const { importId, fileKey, mimetype } = job.data;
    const record = await this.prisma.jobImport.findUnique({
      where: { id: importId },
    });
    if (!record) return;

    await this.prisma.jobImport.update({
      where: { id: importId },
      data: { status: ImportStatus.PROCESSING },
    });

    try {
      const imageBuffer = await this.fetchScreenshot(fileKey);
      const outcome = await this.extraction.extractFromScreenshot(
        imageBuffer,
        mimetype || 'image/png',
      );
      await this.finishOutcome(importId, record.user_id, outcome, 'screenshot');
    } catch (error) {
      await this.handleError(importId, error);
    }
  }

  /** Persist the parsed outcome + mark COMPLETE + notify the user */
  private async finishOutcome(
    importId: string,
    userId: string,
    outcome: ExtractionOutcome,
    channel: 'email' | 'screenshot',
  ) {
    const { parsed, method, confidence, ocrText, aiModel, aiTokensUsed } =
      outcome;

    // Nothing usable extracted at all → treat as a manual-review failure.
    if (!parsed.address && !parsed.appointment_time) {
      return this.handleError(
        importId,
        new Error('No signing details could be extracted'),
      );
    }

    await this.prisma.jobImport.update({
      where: { id: importId },
      data: {
        status: ImportStatus.COMPLETE,
        parsed_address: parsed.address ?? null,
        parsed_appointment_time: parsed.appointment_time
          ? new Date(parsed.appointment_time)
          : null,
        parsed_signing_type: parsed.signing_type ?? null,
        parsed_fee: parsed.fee ?? null,
        parsed_platform_fee: parsed.platform_fee ?? null,
        parsed_client_name: parsed.client_name ?? null,
        parsed_client_phone: parsed.client_phone ?? null,
        parsed_client_email: parsed.client_email ?? null,
        parsed_platform_name: parsed.platform_name ?? null,
        parsed_notes: parsed.notes ?? null,
        extraction_method: method,
        extraction_confidence: confidence,
        ocr_text: ocrText ?? null,
        ai_model_used: aiModel ?? null,
        ai_tokens_used: aiTokensUsed ?? null,
        processed_at: new Date(),
      },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    const notificationConfig =
      await this.userSettings.getNotificationConfig(userId);
    if (user && notificationConfig.prefs.job_imported) {
      await this.notifications.sendPushToUser(userId, {
        title: 'Job import ready',
        body: 'Your imported job is ready for review.',
        url: `/import?review=${importId}`,
        tag: `job-import-${importId}`,
      });
      const appUrl =
        this.config.get<string>('APP_URL') || 'http://localhost:3000';
      const rendered = this.emailRenderer.render({
        title: 'Job import ready',
        subtitle:
          channel === 'email' ? 'Forwarded email parsed' : 'Screenshot parsed',
        greeting: `Hi ${user.full_name || user.username || 'Notary'},`,
        intro: 'Your import was successfully parsed and is ready for review.',
        contentHtml:
          '<p style="font-size:13px;line-height:1.7;color:#475569">Review the extracted details and confirm the job before adding it to your schedule.</p>',
        action: {
          label: 'Review import',
          url: `${appUrl}/import?review=${importId}`,
        },
        plainText: `Your ${channel === 'email' ? 'forwarded email' : 'uploaded screenshot'} was parsed. Review it at ${appUrl}/import?review=${importId}.`,
      });
      await this.notifications.sendNotificationEmail({
        to: user.email,
        subject: 'Your job import is ready for review',
        html: rendered.html,
        text: rendered.text,
      });
    }

    this.logger.log(
      `Job import ${importId} parsed successfully (${channel}, method=${method}, source=${aiModel ?? 'rule'}, confidence=${confidence.toFixed(2)})`,
    );
    this.analytics.track('job_import_completed', userId, {
      channel,
      model: aiModel ?? 'rule',
      extractionMethod: method,
      confidence,
    });
  }

  /** Fetch a received email's body from the Resend API by its email_id */
  private async fetchEmailBody(emailId: string | null): Promise<string> {
    if (!emailId) return '';
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      this.logger.warn('RESEND_API_KEY is not configured');
      return '';
    }

    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.receiving.get(emailId);
    if (error) {
      throw new Error(`Resend fetch failed: ${error.message}`);
    }
    return data?.text ?? data?.html ?? '';
  }

  /** Fetch a screenshot's raw bytes from R2 */
  private async fetchScreenshot(fileKey: string): Promise<Buffer> {
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
      credentials: { accessKeyId, secretAccessKey },
    });

    const result = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: fileKey }),
    );
    if (!result.Body) {
      throw new Error(`Screenshot not found in R2: ${fileKey}`);
    }
    const bytes = await result.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  /**
   * Mark an import FAILED and log the error. Fully defensive: any secondary
   * failure (DB down, notification error) is logged but never rethrown, so a
   * parsing error can never crash or repeatedly requeue the worker.
   */
  private async handleError(importId: string, error: unknown) {
    try {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Job import ${importId} failed: ${errorMessage}`);
      await this.prisma.jobImport.update({
        where: { id: importId },
        data: {
          status: ImportStatus.FAILED,
          error_message: errorMessage,
          processed_at: new Date(),
        },
      });

      const importRecord = await this.prisma.jobImport.findUnique({
        where: { id: importId },
        select: { user_id: true },
      });
      if (!importRecord) return;
      const user = await this.prisma.user.findUnique({
        where: { id: importRecord.user_id },
      });
      const config = await this.userSettings.getNotificationConfig(
        importRecord.user_id,
      );
      if (!user || !config.prefs.import_failed) return;

      await this.notifications.sendPushToUser(importRecord.user_id, {
        title: 'Import failed',
        body: 'An import could not be parsed. Tap to enter the job manually.',
        url: '/jobs/new',
        tag: `import-failed-${importId}`,
      });
      const rendered = this.emailRenderer.render({
        title: 'Import failed',
        subtitle: 'Manual review needed',
        greeting: `Hi ${user.full_name || user.username || 'Notary'},`,
        intro: 'We could not automatically parse this import.',
        contentHtml:
          '<p style="font-size:13px;line-height:1.7;color:#475569">You can enter the signing details manually and add the job to your schedule.</p>',
        action: {
          label: 'Enter job manually',
          url: `${this.config.get<string>('APP_URL') || 'http://localhost:3000'}/jobs/new`,
        },
        plainText:
          'We could not automatically parse this import. Enter the job manually to add it to your schedule.',
      });
      await this.notifications.sendNotificationEmail({
        to: user.email,
        subject: 'Your job import needs manual review',
        html: rendered.html,
        text: rendered.text,
      });
    } catch (err) {
      this.logger.error(
        `Failed to record failure for job import ${importId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
